import { describe, it, expect, vi } from "vitest";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import type { NoteFile } from "../adapters/vaultPort";
import { DEFAULT_PERIODIC_CONFIG } from "../types";
import type { PeriodicConfig } from "../types";
import { PeriodicNoteIndex } from "./periodicNoteIndex";
import type { PeriodicConfigs } from "./periodicNoteIndex";
import { createPeriodicNote } from "./noteCreate";
import { substituteTemplateTokens } from "./templateTokens";
import { templateOnArrival } from "./templateOnArrival";
import { guardCreation, PredecessorGuard } from "./predecessorGuard";

// Every substitution pass counted, as templateAppliedOnce.test.ts does: the
// real expansion is kept, so no test passes on content nobody produced.
vi.mock("./templateTokens", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./templateTokens")>();
	return { ...actual, substituteTemplateTokens: vi.fn(actual.substituteTemplateTokens) };
});
const passes = vi.mocked(substituteTemplateTokens);

window.moment.locale("en");

/**
 * A vault that reports its own creates, the way Obsidian does: the `create`
 * event fires once the content is on disk. The shared fake stays silent on
 * `createFile` so the index tests keep seeing only the changes they emit.
 */
class HostVault extends FakeVaultPort {
	override async createFile(path: string, content: string): Promise<NoteFile> {
		const file = await super.createFile(path, content);
		this.emitChange({ kind: "create", file });
		return file;
	}
}

const DAY_TEMPLATE = "Templates/daily.md";
const WEEK_TEMPLATE = "Templates/weekly.md";
const DAY_BODY = "# {{title}}\n\n{{date}} follows {{yesterday}}.\n";
const DAY_DONE = "# 2026-04-13\n\n2026-04-13 follows 2026-04-12.\n";
const DAY_PATH = "Daily/2026-04-13.md";
const WEEK_PATH = "Weekly/2026-W16.md";

const dayConfig: PeriodicConfig = {
	...DEFAULT_PERIODIC_CONFIG,
	enabled: true,
	format: "YYYY-MM-DD",
	folder: "Daily",
	templatePath: DAY_TEMPLATE,
};
const weekConfig: PeriodicConfig = {
	...DEFAULT_PERIODIC_CONFIG,
	enabled: true,
	format: "GGGG-[W]WW",
	folder: "Weekly",
	templatePath: WEEK_TEMPLATE,
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(configs: PeriodicConfigs = { day: dayConfig, week: weekConfig }, seed?: (vault: HostVault) => void) {
	const vault = new HostVault();
	vault.seedFolder("Templates");
	vault.seedFolder("Daily");
	vault.seedFolder("Weekly");
	vault.seedFile(DAY_TEMPLATE, DAY_BODY);
	vault.seedFile(WEEK_TEMPLATE, "# {{title}}\n");
	seed?.(vault);
	const vaultConfig = new FakeVaultConfigPort("");
	const index = new PeriodicNoteIndex(vault, vaultConfig, configs);
	const stop = templateOnArrival(vault, vaultConfig, index, (granularity) => {
		const config = configs[granularity];
		if (!config) throw new Error(`no ${String(granularity)} config in this test`);
		return config;
	});
	return { vault, index, stop };
}

describe("US-NOTE-10 — an empty matching file created while Calendaric runs gets its template", () => {
	it("AC-NOTE-10.1: an empty day file the user creates receives the day template, tokens substituted", async () => {
		const { vault } = setup();

		await vault.createFile(DAY_PATH, "");
		await settle();

		expect(vault.contentAt(DAY_PATH)).toBe(DAY_DONE);
	});

	it("AC-NOTE-10.1: an empty week file another plugin creates receives the week template", async () => {
		const { vault } = setup();

		await vault.createFile(WEEK_PATH, "");
		await settle();

		expect(vault.contentAt(WEEK_PATH)).toBe("# 2026-W16\n");
	});

	it("AC-NOTE-10.1: Calendaric's own create with a non-empty template ends in exactly one substitution", async () => {
		const { vault } = setup();
		const reads = vi.spyOn(vault, "readFile");
		const writes = vi.spyOn(vault, "processFile");
		passes.mockClear();

		await createPeriodicNote(DAY_PATH, window.moment("2026-04-13"), "day", dayConfig, vault, () => undefined);
		await settle();

		// The arrival handler did look at Calendaric's own note, and stopped there.
		expect(reads).toHaveBeenCalledWith({ path: DAY_PATH });
		expect(passes).toHaveBeenCalledTimes(1);
		expect(writes).not.toHaveBeenCalled();
		expect(vault.contentAt(DAY_PATH)).toBe(DAY_DONE);
	});

	it("AC-NOTE-10.1: an empty file in the day folder whose name is no period's note is left untouched", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { vault } = setup();
		const writes = vi.spyOn(vault, "processFile");

		await vault.createFile("Daily/shopping.md", "");
		await vault.createFile("Elsewhere/2026-04-13.md", "");
		await settle();

		expect(writes).not.toHaveBeenCalled();
		expect(errors).not.toHaveBeenCalled();
		expect(vault.contentAt("Daily/shopping.md")).toBe("");
		expect(vault.contentAt("Elsewhere/2026-04-13.md")).toBe("");
		errors.mockRestore();
	});

	it("AC-NOTE-10.1: an empty note in a subfolder of the day folder is the day's note, but not directly in the folder, so it stays empty", async () => {
		const { vault, index } = setup();

		await vault.createFile("Daily/archive/2026-04-13.md", "");
		await settle();

		expect(index.granularityOf("Daily/archive/2026-04-13.md")).toBe("day");
		expect(vault.contentAt("Daily/archive/2026-04-13.md")).toBe("");
	});

	it("AC-NOTE-10.1: with prefix matching on, an empty prefix-matched name is the day's note, but not the format's name, so it stays empty", async () => {
		const { vault, index } = setup({ day: { ...dayConfig, allowPrefixMatch: true } });

		await vault.createFile("Daily/2026-04-13 standup.md", "");
		await settle();

		expect(index.granularityOf("Daily/2026-04-13 standup.md")).toBe("day");
		expect(vault.contentAt("Daily/2026-04-13 standup.md")).toBe("");
	});

	it("AC-NOTE-10.2: a matching file created with content is left byte-identical", async () => {
		const { vault } = setup();
		const writes = vi.spyOn(vault, "processFile");
		const written = "my own words\n";

		await vault.createFile(DAY_PATH, written);
		await settle();

		expect(writes).not.toHaveBeenCalled();
		expect(vault.contentAt(DAY_PATH)).toBe(written);
	});

	it("AC-NOTE-10.2: text typed into the new file while the template is read is kept", async () => {
		const { vault } = setup();
		const read = vault.readFile.bind(vault);
		vi.spyOn(vault, "readFile").mockImplementation(async (file) => {
			// The user types after the emptiness check, before the write.
			if (file.path === DAY_TEMPLATE) vault.seedFile(DAY_PATH, "typed\n");
			return read(file);
		});

		await vault.createFile(DAY_PATH, "");
		await settle();

		expect(vault.contentAt(DAY_PATH)).toBe("typed\n");
	});

	it("US-NOTE-10: a change that is not a create, such as the host parsing an empty note already there, writes nothing", async () => {
		const { vault } = setup(undefined, (seeded) => seeded.seedFile(DAY_PATH, ""));
		const writes = vi.spyOn(vault, "processFile");

		vault.emitChange({ kind: "metadata", file: { path: DAY_PATH } });
		await settle();

		expect(writes).not.toHaveBeenCalled();
		expect(vault.contentAt(DAY_PATH)).toBe("");
	});

	it("US-NOTE-10: a rename onto a matching name is not a create, and is not templated", async () => {
		const { vault } = setup(undefined, (seeded) => seeded.seedFile("Daily/draft.md", ""));

		vault.renameFile("Daily/draft.md", DAY_PATH);
		vault.emitChange({ kind: "rename", file: { path: DAY_PATH }, oldPath: "Daily/draft.md" });
		await settle();

		expect(vault.contentAt(DAY_PATH)).toBe("");
	});

	it("AC-NOTE-10.1: with no template configured, or a missing template file, nothing is written and nothing is shown", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { vault } = setup({ day: { ...dayConfig, templatePath: "" }, week: { ...weekConfig, templatePath: "Templates/gone.md" } });
		const writes = vi.spyOn(vault, "processFile");

		await vault.createFile(DAY_PATH, "");
		await vault.createFile(WEEK_PATH, "");
		await settle();

		expect(writes).not.toHaveBeenCalled();
		expect(vault.contentAt(DAY_PATH)).toBe("");
		expect(vault.contentAt(WEEK_PATH)).toBe("");
		expect(errors).not.toHaveBeenCalled();
		errors.mockRestore();
	});

	it("US-NOTE-10: an empty day file stays empty, with no notice, while core Daily Notes still owns the day", async () => {
		const { vault } = setup();
		const shown: string[] = [];
		const dailyNotesOn = new PredecessorGuard(
			{
				companion: {
					readDailyNotes: () => ({ ok: true, value: { enabled: true, format: "", folder: "", template: "" } }),
					disableDailyNotes: () => ({ ok: true }),
				},
				calendar: {
					readCalendarWeeklyNotes: () => ({ ok: true, value: false }),
					disableCalendarWeeklyNotes: async () => ({ ok: true }),
				},
				periodicNotes: {
					readActiveGranularities: () => ({ ok: true, value: [] }),
					disableGranularity: async () => ({ ok: true }),
				},
			},
			() => true,
			(message) => shown.push(message),
		);
		guardCreation(vault.backingVault, dailyNotesOn);

		await vault.createFile(DAY_PATH, "");
		await vault.createFile(WEEK_PATH, "");
		await settle();

		expect(vault.contentAt(DAY_PATH)).toBe("");
		expect(shown).toEqual([]);
		expect(vault.contentAt(WEEK_PATH)).toBe("# 2026-W16\n");
	});

	it("US-NOTE-10: after unsubscribing, a new empty matching file is left alone", async () => {
		const { vault, stop } = setup();

		stop();
		await vault.createFile(DAY_PATH, "");
		await settle();

		expect(vault.contentAt(DAY_PATH)).toBe("");
	});

	it("US-NOTE-10: a create already in flight when the plugin unsubscribes writes nothing", async () => {
		const { vault, stop } = setup();

		await vault.createFile(DAY_PATH, "");
		stop();
		await settle();

		expect(vault.contentAt(DAY_PATH)).toBe("");
	});

	it("US-NOTE-10: the template's fold state comes with it, as on a note Calendaric creates", async () => {
		const { vault } = setup();
		const folds = { folds: [{ from: 0, to: 1 }], lines: 3 };
		vault.seedFoldState(DAY_TEMPLATE, folds);

		await vault.createFile(DAY_PATH, "");
		await settle();

		expect(vault.appliedFoldStates).toEqual([{ path: DAY_PATH, foldState: folds }]);
	});
});
