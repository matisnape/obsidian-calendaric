// @vitest-environment happy-dom
//
// US-CMD-10: the date switcher, driven through the real onload(). The natural
// language date plugin is faked at its port, and the switcher's own modal is
// caught as it opens so a test can type into it and confirm.
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Command } from "obsidian";
import { TFile, View } from "obsidian";
import CalendaricPlugin from "../main";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import type { NaturalDatesPort } from "../adapters/companionPluginPort";
import type { PeriodNotePorts } from "../notes/periodNoteOpen";
import { computeNotePath } from "../notes/noteUtils";
import { defaultStoredConfig, resolveEffectiveConfig } from "../settings/model";
import { restoreLocale } from "../fmt/locale";
import { DateSwitcherModal } from "../ui/dateSwitcherModal";
import type { ReleaseGranularity } from "../types";

const notices = vi.hoisted(() => [] as string[]);

vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<typeof import("obsidian")>()),
	getLanguage: () => "en",
	setTooltip: () => undefined,
	MarkdownView: class {},
	Notice: class {
		constructor(message: string) {
			notices.push(message);
		}
	},
}));

afterEach(() => {
	restoreLocale();
	notices.length = 0;
	vi.restoreAllMocks();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const SWITCHER_ID = "open-date-switcher";
const DAY_TEMPLATE = "Templates/daily.md";
const WEEK_TEMPLATE = "Templates/weekly.md";

const PHRASES: Record<string, string> = {
	"last monday": "2026-11-02",
	tomorrow: "2026-11-05",
	"next week": "2026-11-11",
	"next quarter": "2027-02-04",
};

function fakeNaturalDates(available: boolean): NaturalDatesPort {
	return {
		isAvailable: () => available,
		parseDate: (phrase) => {
			const iso = PHRASES[phrase.toLowerCase()];
			return iso === undefined ? null : new Date(`${iso}T12:00:00`);
		},
	};
}

interface Options {
	/** null: no override, so the real adapter reads an empty plugin registry. */
	naturalDates: NaturalDatesPort | null;
	activeLeaf: boolean;
	isMacOS?: boolean;
	weeklyNotes?: boolean;
	/** Notes the plugin's index finds in the vault, each with the frontmatter it carries. */
	indexed?: Record<string, Record<string, string>>;
}

async function loadedPlugin({ naturalDates, activeLeaf, isMacOS = false, weeklyNotes = true, indexed = {} }: Options) {
	const stored = defaultStoredConfig();
	const set = stored.calendarSets[0];
	if (!set) throw new Error("default configuration has no calendar set");
	set.day = { ...set.day, enabled: true, templatePath: DAY_TEMPLATE };
	set.week = { ...set.week, enabled: weeklyNotes, templatePath: WEEK_TEMPLATE };

	const vault = new FakeVaultPort();
	vault.seedFolder("Templates");
	vault.seedFile(DAY_TEMPLATE, "Daily template\n");
	vault.seedFile(WEEK_TEMPLATE, "Weekly template\n");
	const workspace = new FakeWorkspacePort();
	workspace.isMacOS = isMacOS;
	const ports: PeriodNotePorts = { vault, vaultConfig: new FakeVaultConfigPort(""), workspace };

	const commands: Command[] = [];
	const files = Object.keys(indexed).map((path) => Object.assign(new TFile(), { path }));
	let layoutReady: () => void = () => undefined;
	const on = () => ({});
	const plugin = new CalendaricPlugin({} as never, {} as never);
	Object.assign(plugin, {
		app: {
			plugins: { getPlugin: () => null },
			workspace: {
				onLayoutReady: (callback: () => void) => {
					layoutReady = callback;
				},
				getLeavesOfType: () => [],
				getRightLeaf: () => null,
				getActiveViewOfType: (type: unknown) => (activeLeaf && type === View ? {} : null),
				on,
			},
			vault: { on, getMarkdownFiles: () => files },
			metadataCache: {
				on,
				offref: () => undefined,
				getFileCache: (file: TFile) => ({ frontmatter: indexed[file.path] }),
				getFirstLinkpathDest: () => null,
			},
		},
		loadData: () => Promise.resolve(JSON.parse(JSON.stringify(stored)) as unknown),
		saveData: () => Promise.resolve(),
		registerView: () => undefined,
		addSettingTab: () => undefined,
		registerHoverLinkSource: () => undefined,
		addRibbonIcon: () => document.createElement("div"),
		addCommand: (command: Command) => {
			commands.push(command);
			return command;
		},
		removeCommand: () => undefined,
		registerEvent: () => undefined,
		registerInterval: (id: number) => id,
		notePorts: () => ports,
		...(naturalDates ? { naturalDatesPort: () => naturalDates } : {}),
	});
	await plugin.onload();
	layoutReady();

	const pathOf = (granularity: ReleaseGranularity, iso: string) =>
		computeNotePath(window.moment(iso), resolveEffectiveConfig(plugin.settings, granularity), ports.vaultConfig, granularity);
	const notePaths = () => vault.listNotes().map(({ path }) => path).sort();
	return { commands, vault, workspace, pathOf, notePaths };
}

type Loaded = Awaited<ReturnType<typeof loadedPlugin>>;

function switcher(loaded: Loaded): Command {
	const command = loaded.commands.find(({ id }) => id === SWITCHER_ID);
	if (!command?.checkCallback) throw new Error("no date switcher command with a checkCallback");
	return command;
}

function openSwitcher(loaded: Loaded): DateSwitcherModal {
	const open = vi.spyOn(DateSwitcherModal.prototype, "open").mockImplementation(() => undefined);
	switcher(loaded).checkCallback?.(false);
	const opened = open.mock.contexts.at(-1);
	if (!(opened instanceof DateSwitcherModal)) throw new Error("the command opened no date switcher");
	return opened;
}

async function confirm(modal: DateSwitcherModal, phrase: string, keys: KeyboardEventInit = {}): Promise<void> {
	modal.inputEl.value = phrase;
	modal.selectActiveSuggestion(new KeyboardEvent("keydown", { key: "Enter", ...keys }));
	await flush();
}

/** Presses the switcher's own Cmd/Ctrl+Enter binding, as the host would on that chord. */
async function confirmWithModBinding(modal: DateSwitcherModal, phrase: string, keys: KeyboardEventInit): Promise<void> {
	type Handler = { modifiers: string[] | null; key: string | null; func: (evt: KeyboardEvent) => unknown };
	const handlers = (modal.scope as unknown as { handlers: Handler[] }).handlers;
	const binding = handlers.find(({ modifiers, key }) => key === "Enter" && modifiers?.includes("Mod"));
	if (!binding) throw new Error("the switcher registers no Mod+Enter binding");
	modal.inputEl.value = phrase;
	binding.func(new KeyboardEvent("keydown", { key: "Enter", ...keys }));
	await flush();
}

describe("US-CMD-10: the date switcher command is listed only when it can work", () => {
	it("AC-CMD-10.1: with the date plugin enabled and a leaf active, the palette lists the date switcher", async () => {
		const loaded = await loadedPlugin({ naturalDates: fakeNaturalDates(true), activeLeaf: true });

		expect(switcher(loaded).name).toBe("Open date switcher");
		expect(switcher(loaded).checkCallback?.(true)).toBe(true);
	});

	it("AC-CMD-10.2: with the date plugin absent or disabled, the switcher is not listed, nothing is said, and every other command is the same", async () => {
		const errors = vi.spyOn(console, "error");
		const warnings = vi.spyOn(console, "warn");
		const enabled = await loadedPlugin({ naturalDates: fakeNaturalDates(true), activeLeaf: true });
		const disabled = await loadedPlugin({ naturalDates: fakeNaturalDates(false), activeLeaf: true });
		const absent = await loadedPlugin({ naturalDates: null, activeLeaf: true });
		const opens = vi.spyOn(DateSwitcherModal.prototype, "open");

		for (const loaded of [disabled, absent]) {
			expect(switcher(loaded).checkCallback?.(true)).toBe(false);
			expect(switcher(loaded).checkCallback?.(false)).toBe(false);
			const others = (list: Command[]) => list.filter(({ id }) => id !== SWITCHER_ID).map(({ id, name }) => [id, name]);
			expect(others(loaded.commands)).toEqual(others(enabled.commands));
			expect(loaded.workspace.notices).toEqual([]);
		}
		expect(opens).not.toHaveBeenCalled();
		expect(notices).toEqual([]);
		expect(errors).not.toHaveBeenCalled();
		expect(warnings).not.toHaveBeenCalled();
	});

	it("AC-CMD-10.6: with the date plugin enabled but no leaf active, the switcher is not listed", async () => {
		const loaded = await loadedPlugin({ naturalDates: fakeNaturalDates(true), activeLeaf: false });

		expect(switcher(loaded).checkCallback?.(true)).toBe(false);
	});
});

describe("US-CMD-10: confirming a phrase lands on that period's note", () => {
	it("AC-CMD-10.3: a phrase naming a day that has a note opens that note in the active pane and writes no second one", async () => {
		const loaded = await loadedPlugin({ naturalDates: fakeNaturalDates(true), activeLeaf: true });
		const mondayPath = loaded.pathOf("day", "2026-11-02");
		loaded.vault.seedFile(mondayPath, "kept");
		const before = loaded.notePaths();

		await confirm(openSwitcher(loaded), "last monday");

		expect(loaded.workspace.opened.map(({ file, mode }) => [file.path, mode])).toEqual([[mondayPath, "reuse"]]);
		expect(loaded.notePaths()).toEqual(before);
		const note = loaded.vault.getFile(mondayPath);
		expect(note && (await loaded.vault.readFile(note))).toBe("kept");
	});

	it("AC-CMD-10.3: a day whose note the index finds under another name opens that note, and the switcher names it", async () => {
		const loaded = await loadedPlugin({
			naturalDates: fakeNaturalDates(true),
			activeLeaf: true,
			indexed: { "Journal/monday.md": { day: "2026-11-02" } },
		});
		const modal = openSwitcher(loaded);
		const [suggestion] = modal.getSuggestions("last monday");
		if (!suggestion) throw new Error("no suggestion for last monday");
		const el = document.createElement("div");
		modal.renderSuggestion(suggestion, el);

		await confirm(modal, "last monday");

		expect(el.querySelector("small")?.textContent).toBe("monday");
		expect(loaded.workspace.opened.map(({ file, mode }) => [file.path, mode])).toEqual([["Journal/monday.md", "reuse"]]);
		expect(loaded.vault.getFile(loaded.pathOf("day", "2026-11-02"))).toBeNull();
	});

	it("AC-CMD-10.4: a phrase naming a day with no note creates it from the daily template and opens it in the active pane", async () => {
		const loaded = await loadedPlugin({ naturalDates: fakeNaturalDates(true), activeLeaf: true });
		const dayPath = loaded.pathOf("day", "2026-11-05");
		expect(loaded.vault.getFile(dayPath)).toBeNull();

		await confirm(openSwitcher(loaded), "tomorrow");

		expect(loaded.vault.contentAt(dayPath)).toBe("Daily template\n");
		expect(loaded.workspace.opened.map(({ file, mode }) => [file.path, mode])).toEqual([[dayPath, "reuse"]]);
	});

	it("AC-CMD-10.4: a phrase naming a week with no note creates it from the weekly template and opens it in the active pane", async () => {
		const loaded = await loadedPlugin({ naturalDates: fakeNaturalDates(true), activeLeaf: true });
		const weekPath = loaded.pathOf("week", "2026-11-11");
		expect(loaded.vault.getFile(weekPath)).toBeNull();

		await confirm(openSwitcher(loaded), "next week");

		expect(loaded.vault.contentAt(weekPath)).toBe("Weekly template\n");
		expect(loaded.workspace.opened.map(({ file, mode }) => [file.path, mode])).toEqual([[weekPath, "reuse"]]);
	});

	it("AC-CMD-10.5: a phrase the parser does not recognise opens and creates nothing, and the switcher stays open saying so", async () => {
		const loaded = await loadedPlugin({ naturalDates: fakeNaturalDates(true), activeLeaf: true });
		const before = loaded.notePaths();
		const modal = openSwitcher(loaded);
		const close = vi.spyOn(modal, "close");

		await confirm(modal, "purple elephant");

		expect(loaded.workspace.opened).toEqual([]);
		expect(loaded.notePaths()).toEqual(before);
		expect(close).not.toHaveBeenCalled();
		// What the host shows in an empty list.
		expect(modal.getSuggestions("purple elephant")).toEqual([]);
		expect(modal.emptyStateText).toMatch(/not recognised/i);
	});

	it("AC-CMD-10.5: a phrase the parser reads, for a period whose notes are off, says the notes are off, not that it was not recognised", async () => {
		const loaded = await loadedPlugin({ naturalDates: fakeNaturalDates(true), activeLeaf: true, weeklyNotes: false });
		const modal = openSwitcher(loaded);

		expect(modal.getSuggestions("next week")).toEqual([]);
		expect(modal.emptyStateText).toMatch(/turned off/i);
		expect(modal.getSuggestions("purple elephant")).toEqual([]);
		expect(modal.emptyStateText).toMatch(/not recognised/i);
		// Quarter is reserved (DEC-23): no setting turns its notes on, so the parser reading it changes nothing.
		expect(modal.getSuggestions("next quarter")).toEqual([]);
		expect(modal.emptyStateText).toMatch(/not recognised/i);
	});
});

describe("US-CMD-10: the split modifier opens the note beside the active pane", () => {
	it("AC-CMD-10.7: on macOS, Cmd+Enter opens the note in a new split, and Ctrl+Enter does not", async () => {
		const loaded = await loadedPlugin({ naturalDates: fakeNaturalDates(true), activeLeaf: true, isMacOS: true });
		const dayPath = loaded.pathOf("day", "2026-11-05");

		await confirmWithModBinding(openSwitcher(loaded), "tomorrow", { metaKey: true });
		await confirm(openSwitcher(loaded), "tomorrow", { ctrlKey: true });

		expect(loaded.workspace.opened.map(({ file, mode }) => [file.path, mode])).toEqual([
			[dayPath, "split"],
			[dayPath, "reuse"],
		]);
	});

	it("AC-CMD-10.7: on other platforms, Ctrl+Enter opens the note in a new split, and Cmd+Enter does not", async () => {
		const loaded = await loadedPlugin({ naturalDates: fakeNaturalDates(true), activeLeaf: true, isMacOS: false });
		const dayPath = loaded.pathOf("day", "2026-11-05");

		await confirmWithModBinding(openSwitcher(loaded), "tomorrow", { ctrlKey: true });
		await confirm(openSwitcher(loaded), "tomorrow", { metaKey: true });

		expect(loaded.workspace.opened.map(({ file, mode }) => [file.path, mode])).toEqual([
			[dayPath, "split"],
			[dayPath, "reuse"],
		]);
	});
});
