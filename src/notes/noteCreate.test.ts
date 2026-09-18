import { describe, it, expect, vi } from "vitest";
import moment from "moment";
import { createNote, createPeriodicNote } from "./noteCreate";
import { computeNotePath } from "./noteUtils";
import { openNoteIn } from "./noteOpen";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { RELEASE_GRANULARITIES } from "../types";
import type { PeriodicConfig, ReleaseGranularity } from "../types";

function makeConfig(overrides: Partial<PeriodicConfig> = {}): PeriodicConfig {
	return {
		enabled: true,
		format: "YYYY-MM-DD",
		folder: "",
		templatePath: "",
		allowPrefixMatch: false,
		openAtStartup: false,
		...overrides,
	};
}

const DATE = moment("2026-04-13T14:30:00");

/** For the cases that are not about warnings: `warn` is required, so every call names one. */
const noWarn = () => undefined;

describe("createNote (AC-ARCH-03.1, AC-ARCH-03.2)", () => {
	it("creates the file with empty content when no template is configured (AC-NOTE-05.2)", async () => {
		const vault = new FakeVaultPort();
		const warn = vi.fn();

		const file = await createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault, warn);

		expect(file.path).toBe("journal/daily/2026-04-13.md");
		expect(vault.contentAt("journal/daily/2026-04-13.md")).toBe("");
		expect(warn).not.toHaveBeenCalled();
	});

	it("creates the missing target folder before creating the file (AC-ARCH-03.3: target folder missing)", async () => {
		const vault = new FakeVaultPort();

		await createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault, noWarn);

		expect(vault.createdFolders).toEqual(["journal", "journal/daily"]);
	});

	it("creates every missing intermediate folder, top down (AC-NOTE-03.5)", async () => {
		const vault = new FakeVaultPort();

		await createNote("journal/daily/2026/2026-04-13.md", DATE, "day", makeConfig(), vault, noWarn);

		expect(vault.createdFolders).toEqual(["journal", "journal/daily", "journal/daily/2026"]);
	});

	it("creates only the intermediate folders that are still missing (AC-NOTE-03.5)", async () => {
		const vault = new FakeVaultPort();
		vault.seedFolder("journal");

		await createNote("journal/daily/2026/2026-04-13.md", DATE, "day", makeConfig(), vault, noWarn);

		expect(vault.createdFolders).toEqual(["journal/daily", "journal/daily/2026"]);
	});

	it("writes the note even though the whole folder chain was missing (AC-NOTE-03.1, AC-NOTE-03.4, AC-NOTE-05.2)", async () => {
		const vault = new FakeVaultPort();

		const file = await createNote("a/b/c/2026-04-13.md", DATE, "day", makeConfig(), vault, noWarn);

		expect(file.path).toBe("a/b/c/2026-04-13.md");
		expect(vault.contentAt("a/b/c/2026-04-13.md")).toBe("");
	});

	it("creates no folder for a note at the vault root (AC-NOTE-03.3, AC-NOTE-05.2)", async () => {
		const vault = new FakeVaultPort();

		await createNote("2026-04-13.md", DATE, "day", makeConfig(), vault, noWarn);

		expect(vault.createdFolders).toEqual([]);
		expect(vault.contentAt("2026-04-13.md")).toBe("");
	});

	it("does not recreate a folder that already exists", async () => {
		const vault = new FakeVaultPort();
		vault.seedFolder("journal");
		vault.seedFolder("journal/daily");

		await createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault, noWarn);

		expect(vault.createdFolders).toEqual([]);
	});

	it("accepts a folder another actor created between the check and the call (AC-NOTE-03.1, AC-NOTE-05.2)", async () => {
		const vault = new FakeVaultPort();
		vault.loseCreateFolderRace("journal");

		const file = await createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault, noWarn);

		expect(file.path).toBe("journal/daily/2026-04-13.md");
		expect(vault.contentAt("journal/daily/2026-04-13.md")).toBe("");
		expect(vault.createdFolders).toEqual(["journal/daily"]);
	});

	// Guards the fix for the race above against swallowing every failure: the
	// folder is still absent afterwards, so the error has to come back out.
	it("rethrows a folder failure that left the folder absent", async () => {
		const vault = new FakeVaultPort();
		vault.failCreateFolder("journal", new Error("EACCES: permission denied"));

		await expect(
			createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault, noWarn),
		).rejects.toThrow("EACCES: permission denied");
	});

	it("does not mistake a file for an existing folder in the chain", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("journal", "a note sitting where a folder belongs");

		await expect(
			createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault, noWarn),
		).rejects.toThrow("File already exists at: journal");
	});

	// The race recovery asks "is the folder there now?". A file at that path is
	// not the folder we wanted, so it must not count as the race being won.
	it("rethrows a folder failure when only a file appeared at the path", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("journal", "a note sitting where a folder belongs");
		vault.failCreateFolder("journal", new Error("EACCES: permission denied"));

		await expect(
			createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault, noWarn),
		).rejects.toThrow("EACCES: permission denied");
	});

	it("refuses a path with an unusable segment before making any folder", async () => {
		const vault = new FakeVaultPort();

		await expect(
			createNote("journal/../daily/2026-04-13.md", DATE, "day", makeConfig(), vault, noWarn),
		).rejects.toThrow("Cannot create a folder for the path: journal/../daily");
		expect(vault.createdFolders).toEqual([]);
	});

	it("renders the configured template into the note content (AC-NOTE-05.1)", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{title}}");

		const file = await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily.md" }),
			vault,
			noWarn,
		);

		expect(vault.contentAt(file.path)).toBe("# 2026-04-13");
	});

	it("AC-TPL-01.4: substitutes {{title}} with the note's filename, without its extension", async () => {
		// The title comes from the path the note is being written to, not from the
		// configured format -- so a path whose basename cannot be produced by that
		// format is what separates the two sources.
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{title}}");

		const file = await createNote(
			"journal/daily/Monday review.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily.md" }),
			vault,
			noWarn,
		);

		expect(vault.contentAt(file.path)).toBe("# Monday review");
	});

	it("creates an empty note when the configured template is absent (AC-ARCH-03.3: template absent, AC-NOTE-05.3)", async () => {
		const vault = new FakeVaultPort();

		const file = await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/missing.md" }),
			vault,
			noWarn,
		);

		expect(vault.contentAt(file.path)).toBe("");
	});

	it("propagates the failure when a note already exists at the target path (AC-ARCH-03.3: note already exists)", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("journal/daily/2026-04-13.md", "existing content");

		await expect(
			createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault, noWarn),
		).rejects.toThrow("File already exists: journal/daily/2026-04-13.md");
	});

	// FMT-side filename-format validation does not exist yet (FMT epic, not built).
	// This proves the VaultPort seam already carries such a failure end-to-end
	// without inventing that validation logic here (AC-ARCH-03.3: filename format invalid).
	it("propagates a typed rejection surfaced through the port for an invalid filename format (AC-ARCH-03.3: filename format invalid)", async () => {
		const vault = new FakeVaultPort();
		vault.createFileError = new Error("Invalid filename format");

		await expect(
			createNote("journal/daily/2026:04:13.md", DATE, "day", makeConfig(), vault, noWarn),
		).rejects.toThrow("Invalid filename format");
	});

	// FMT-side date-string parsing does not exist yet either (FMT epic, not built).
	// Same seam, same proof (AC-ARCH-03.3: date string unparseable).
	it("propagates a typed rejection surfaced through the port for an unparseable date string (AC-ARCH-03.3: date string unparseable)", async () => {
		const vault = new FakeVaultPort();
		vault.createFileError = new Error("Unparseable date string");

		await expect(
			createNote("journal/daily/Invalid-date.md", moment.invalid(), "day", makeConfig(), vault, noWarn),
		).rejects.toThrow("Unparseable date string");
	});
	it("expands every token the template carries, not only the title (AC-NOTE-05.1)", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile(
			"Templates/daily.md",
			"# {{title}}\n[[{{yesterday}}]] <- {{date}} -> [[{{tomorrow}}]]",
		);

		const file = await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily.md" }),
			vault,
			noWarn,
		);

		expect(vault.contentAt(file.path)).toBe(
			"# 2026-04-13\n[[2026-04-12]] <- 2026-04-13 -> [[2026-04-14]]",
		);
	});

	it("warns by name about a template that cannot be found (AC-NOTE-05.3)", async () => {
		const vault = new FakeVaultPort();
		const warn = vi.fn();

		await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/missing.md" }),
			vault,
			warn,
		);

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("Templates/missing.md"));
	});

	// A folder at the configured path is the one template failure the user can
	// fix without going looking: the path is real, it is just the wrong kind of
	// thing. Saying "not found" about it would be a wrong instruction.
	it("AC-TPL-04.3: names a template path that is a folder as a folder, not as missing", async () => {
		const vault = new FakeVaultPort();
		vault.seedFolder("Templates/daily");
		const warn = vi.fn();

		const file = await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily" }),
			vault,
			warn,
		);

		expect(vault.contentAt(file.path)).toBe("");
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("Templates/daily"));
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("folder"));
		expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("not found"));
	});

	// An empty template is a configured template that says nothing, which is not
	// the same as a broken one. It resolves and it reads, so there is nothing to
	// report — the note simply starts empty.
	it("AC-TPL-04.5: creates an empty note body from an empty template and raises nothing", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/empty.md", "");
		const warn = vi.fn();

		const file = await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/empty.md" }),
			vault,
			warn,
		);

		expect(vault.contentAt(file.path)).toBe("");
		expect(warn).not.toHaveBeenCalled();
	});

	it("AC-TPL-04.1: reports nothing about a template that resolves to a real note", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{title}}");
		const warn = vi.fn();

		await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily.md" }),
			vault,
			warn,
		);

		expect(warn).not.toHaveBeenCalled();
	});

	it("AC-TPL-04.4: reports nothing when no template is configured for the granularity", async () => {
		const vault = new FakeVaultPort();
		const warn = vi.fn();

		const file = await createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault, warn);

		expect(vault.contentAt(file.path)).toBe("");
		expect(warn).not.toHaveBeenCalled();
	});

	// The metadata cache can still name a template that the read then fails on —
	// a file deleted between the two calls, or one Obsidian cannot open.
	it("still creates an empty note when the template read fails (AC-NOTE-05.3)", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{title}}");
		vault.failReadFile("Templates/daily.md", new Error("EIO: read failed"));
		const warn = vi.fn();
		// The reason behind the warning belongs in the console, so it is captured
		// here rather than printed through the suite's output.
		const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const file = await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily.md" }),
			vault,
			warn,
		);

		expect(vault.contentAt(file.path)).toBe("");
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("Templates/daily.md"));
		expect(logged).toHaveBeenCalledTimes(1);
		logged.mockRestore();
	});

	it("applies the template's saved fold state to the new note (AC-NOTE-05.4)", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{title}}");
		const foldState = { folds: [{ from: 0, to: 4 }], lines: 12 };
		vault.seedFoldState("Templates/daily.md", foldState);

		const file = await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily.md" }),
			vault,
			noWarn,
		);

		expect(vault.appliedFoldStates).toEqual([{ path: file.path, foldState }]);
	});

	it("applies no fold state when the template has none saved (AC-NOTE-05.4)", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{title}}");

		await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily.md" }),
			vault,
			noWarn,
		);

		expect(vault.appliedFoldStates).toEqual([]);
	});
	// The template itself read fine. Losing its folds is a cosmetic loss; losing
	// the content the user wrote the template for is not.
	it("keeps the template content when its fold state cannot be read (AC-NOTE-05.1, AC-NOTE-05.4)", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{title}}");
		vault.failReadFoldState("Templates/daily.md", new Error("fold store unavailable"));
		const warn = vi.fn();
		const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const file = await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily.md" }),
			vault,
			warn,
		);

		expect(vault.contentAt(file.path)).toBe("# 2026-04-13");
		expect(vault.appliedFoldStates).toEqual([]);
		expect(warn).not.toHaveBeenCalled();
		expect(logged).toHaveBeenCalledTimes(1);
		logged.mockRestore();
	});

	// The note exists by the time the folds are applied, so a failure there must
	// not reject: the caller still has to get the file back to open it.
	it("returns the created note even when applying the fold state fails (AC-NOTE-05.4)", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{title}}");
		vault.seedFoldState("Templates/daily.md", { folds: [{ from: 0, to: 4 }], lines: 12 });
		vault.failApplyFoldState("journal/daily/2026-04-13.md", new Error("fold save failed"));
		const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const file = await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily.md" }),
			vault,
			noWarn,
		);

		expect(file.path).toBe("journal/daily/2026-04-13.md");
		expect(vault.contentAt(file.path)).toBe("# 2026-04-13");
		expect(logged).toHaveBeenCalledTimes(1);
		logged.mockRestore();
	});
});

/**
 * One configuration per granularity of the release set, each with the format
 * and folder that granularity would really be configured with. The point of
 * every test below is that the four behave identically, so they are always
 * driven from this one table rather than from a hand-written case each.
 */
const RELEASE_CONFIGS: Record<ReleaseGranularity, PeriodicConfig> = {
	day: makeConfig({ format: "YYYY-MM-DD", folder: "journal/daily" }),
	week: makeConfig({ format: "gggg-[W]ww", folder: "journal/weekly" }),
	month: makeConfig({ format: "YYYY-MM", folder: "journal/monthly" }),
	year: makeConfig({ format: "YYYY", folder: "journal/yearly" }),
};

/** The path the release config for `granularity` resolves to for `DATE`. */
function pathFor(granularity: ReleaseGranularity): string {
	return computeNotePath(DATE, RELEASE_CONFIGS[granularity], new FakeVaultConfigPort());
}

/** Runs `check` once per granularity of the release set, on a vault of its own. */
function forEachGranularity(check: (granularity: ReleaseGranularity) => Promise<void>): Promise<void[]> {
	return Promise.all(RELEASE_GRANULARITIES.map(check));
}

describe("createPeriodicNote", () => {
	it("AC-NOTE-04.1: writes the note at the resolved folder and filename, and returns it", async () => {
		await forEachGranularity(async (granularity) => {
			const vault = new FakeVaultPort();
			const path = pathFor(granularity);

			const result = await createPeriodicNote(
				path,
				DATE,
				granularity,
				RELEASE_CONFIGS[granularity],
				vault,
				noWarn,
			);

			expect(result).toEqual({ outcome: "created", file: { path } });
			expect(vault.contentAt(path)).toBe("");
		});
	});

	// The four paths are what "the resolved folder and filename for that
	// granularity" means: a year note must not land on the day note's name.
	it("AC-NOTE-04.1: resolves a distinct path per granularity", async () => {
		const paths = RELEASE_GRANULARITIES.map(pathFor);

		expect(paths).toEqual([
			"journal/daily/2026-04-13.md",
			"journal/weekly/2026-W16.md",
			"journal/monthly/2026-04.md",
			"journal/yearly/2026.md",
		]);
	});

	it("AC-NOTE-04.2: reports the same collision outcome for every granularity", async () => {
		const outcomes: string[] = [];

		await forEachGranularity(async (granularity) => {
			const vault = new FakeVaultPort();
			const path = pathFor(granularity);
			vault.seedFile(path, "written by hand");

			const result = await createPeriodicNote(
				path,
				DATE,
				granularity,
				RELEASE_CONFIGS[granularity],
				vault,
				noWarn,
			);

			outcomes.push(result.outcome);
			expect(result.file.path).toBe(path);
			expect(vault.contentAt(path)).toBe("written by hand");
		});

		expect(outcomes).toEqual(["exists", "exists", "exists", "exists"]);
	});

	// Collected rather than asserted one by one: the criterion is that the four
	// answers are the *same*, which a per-granularity assertion cannot state.
	it("AC-NOTE-04.2: surfaces the same failure for every granularity when the write fails", async () => {
		const messages: string[] = [];

		await forEachGranularity(async (granularity) => {
			const vault = new FakeVaultPort();
			vault.createFileError = new Error("vault is read-only");

			messages.push(
				await createPeriodicNote(
					pathFor(granularity),
					DATE,
					granularity,
					RELEASE_CONFIGS[granularity],
					vault,
					noWarn,
				).then(
					() => "resolved, which it must not",
					(error: Error) => error.message,
				),
			);
		});

		expect(messages).toEqual(RELEASE_GRANULARITIES.map(() => "vault is read-only"));
	});

	it("AC-NOTE-04.3: refuses a granularity outside the release set, by name, and writes nothing", async () => {
		const vault = new FakeVaultPort();

		await expect(
			createPeriodicNote("journal/quarterly/2026-Q2.md", DATE, "quarter", makeConfig(), vault, noWarn),
		).rejects.toThrow(/quarter[\s\S]*not supported in this release/);
		expect(vault.contentAt("journal/quarterly/2026-Q2.md")).toBeUndefined();
		expect(vault.createdFolders).toEqual([]);
	});

	it("AC-NOTE-04.4: creates the missing folder chain first, then the note", async () => {
		await forEachGranularity(async (granularity) => {
			const vault = new FakeVaultPort();
			const path = pathFor(granularity);

			const result = await createPeriodicNote(
				path,
				DATE,
				granularity,
				RELEASE_CONFIGS[granularity],
				vault,
				noWarn,
			);

			expect(result.outcome).toBe("created");
			expect(vault.createdFolders).toEqual(["journal", RELEASE_CONFIGS[granularity].folder]);
			expect(vault.contentAt(path)).toBe("");
		});
	});

	it("AC-NOTE-04.5: leaves an existing note untouched and hands it back to be opened", async () => {
		const vault = new FakeVaultPort();
		const path = pathFor("day");
		vault.seedFile(path, "yesterday's thinking");

		const result = await createPeriodicNote(path, DATE, "day", RELEASE_CONFIGS.day, vault, noWarn);

		expect(result).toEqual({ outcome: "exists", file: { path } });
		expect(vault.contentAt(path)).toBe("yesterday's thinking");
		// The report is what the caller opens: nothing else has to be looked up.
		const workspace = new FakeWorkspacePort();
		await openNoteIn(result.file, "reuse", workspace, path);
		expect(workspace.opened).toEqual([{ file: { path }, mode: "reuse" }]);
	});

	// A note that is already there is not a template subject either: reading the
	// template would expand tokens nobody asked for and warn about a template
	// this call is never going to write.
	it("AC-NOTE-04.5: reads no template and warns about none when the note already exists", async () => {
		const vault = new FakeVaultPort();
		const path = pathFor("day");
		vault.seedFile(path, "yesterday's thinking");
		const warn = vi.fn();

		const result = await createPeriodicNote(
			path,
			DATE,
			"day",
			makeConfig({ ...RELEASE_CONFIGS.day, templatePath: "Templates/missing.md" }),
			vault,
			warn,
		);

		expect(result.outcome).toBe("exists");
		expect(warn).not.toHaveBeenCalled();
	});

	it("AC-NOTE-04.6: names the occupied path and says it is not a Markdown note", async () => {
		await forEachGranularity(async (granularity) => {
			const vault = new FakeVaultPort();
			const path = pathFor(granularity);
			vault.seedFolder(path);

			await expect(
				createPeriodicNote(path, DATE, granularity, RELEASE_CONFIGS[granularity], vault, noWarn),
			).rejects.toThrow(`${path} is not a Markdown note`);

			// Nothing at the path was altered: it is still the folder it was.
			expect(vault.folderExists(path)).toBe(true);
			expect(vault.contentAt(path)).toBeUndefined();
		});
	});
});
