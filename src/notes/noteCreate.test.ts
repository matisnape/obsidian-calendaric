import { describe, it, expect, vi } from "vitest";
import moment from "moment";
import { createNote } from "./noteCreate";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import type { PeriodicConfig } from "../types";

function makeConfig(overrides: Partial<PeriodicConfig> = {}): PeriodicConfig {
	return {
		enabled: true,
		format: "YYYY-MM-DD",
		folder: "",
		templatePath: "",
		openAtStartup: false,
		...overrides,
	};
}

const DATE = moment("2026-04-13T14:30:00");

/** For the cases that are not about warnings: `warn` is required, so every call names one. */
const noWarn = () => undefined;

describe("createNote", () => {
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
