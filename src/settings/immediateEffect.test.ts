// @vitest-environment happy-dom
//
// US-SET-07: a saved setting reaches the rest of the plugin at once, and a
// setting that failed to save reaches none of it. These tests drive the real
// plugin over a fake disk, with a real note index and a fake command palette
// under it, so "the rest of the plugin" is the code that runs in Obsidian.
import { describe, it, expect, vi, afterEach } from "vitest";
import type { App, Command, ToggleComponent } from "obsidian";
import CalendaricPlugin from "../main";
import { CalendaricSettingsTab } from "../settings";
import { CalendarView } from "../ui/CalendarView";
import { VIEW_TYPE_CALENDAR } from "../ui/viewType";
import { PeriodicNoteIndex } from "../notes/periodicNoteIndex";
import type { PeriodicConfigs } from "../notes/periodicNoteIndex";
import type { PeriodNotePorts } from "../notes/periodNoteOpen";
import { restoreLocale } from "../fmt/locale";
import { GRANULARITIES, toSettings } from "./model";
import type { StoredConfig } from "./model";
import type { ReleaseGranularity } from "../types";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { makeSettingsTabPorts } from "../__mocks__/settingsTabPorts";
import { renderPeriodicNotesImportCard } from "./periodicNotesImportCard";
import type { PeriodicNotesCalendarSet } from "../adapters/companionPluginPort";

const notices = vi.hoisted((): string[] => []);
const toggleHandlers = vi.hoisted(() => new WeakMap<HTMLInputElement, (value: boolean) => unknown>());

// The shared mock carries no `getLanguage`, records no notice and draws no
// toggle. This file needs all three.
vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	class ToggleSetting extends actual.Setting {
		addToggle(cb: (toggle: ToggleComponent) => unknown): this {
			const toggleEl = this.controlEl.createEl("input", { type: "checkbox" });
			cb({
				toggleEl,
				setValue: (value: boolean) => (toggleEl.checked = value),
				setDisabled: (disabled: boolean) => (toggleEl.disabled = disabled),
				onChange: (fn: (value: boolean) => unknown) => toggleHandlers.set(toggleEl, fn),
			} as unknown as ToggleComponent);
			return this;
		}
	}
	class RecordedNotice {
		constructor(message: string) {
			notices.push(message);
		}
	}
	return { ...actual, Setting: ToggleSetting, Notice: RecordedNotice, getLanguage: () => "en" };
});

interface FakeDisk {
	/** What `loadData()` would return, exactly as JSON left it. */
	data: unknown;
	writes: number;
	/** When set, the next `saveData()` throws and writes nothing. */
	failNext: boolean;
}

/** The palette as Obsidian keeps it: ids prefixed with the plugin's own. */
class FakeCommandHost {
	private palette = new Map<string, Command>();

	addCommand(command: Command): Command {
		const filed = { ...command, id: `calendaric:${command.id}` };
		this.palette.set(filed.id, filed);
		return filed;
	}

	removeCommand(id: string): void {
		this.palette.delete(id);
	}

	has(id: string): boolean {
		return this.palette.has(`calendaric:${id}`);
	}
}

interface Internals {
	index: PeriodicNoteIndex | null;
	indexConfigs(): PeriodicConfigs;
	registerGranularityCommands(): void;
	openPeriodNote(granularity: ReleaseGranularity, date: ReturnType<typeof window.moment>): Promise<void>;
	stored: StoredConfig;
}

const DATE = "2026-04-13";

/**
 * The real plugin, loaded from a disk whose daily notes live in `Daily/`, and
 * already holding the index, commands and calendar view `onload` would build.
 *
 * The write goes through JSON, because that is what Obsidian's own `saveData`
 * does.
 */
async function loadedPlugin(...notes: string[]) {
	const disk: FakeDisk = { data: null, writes: 0, failNext: false };
	const vault = new FakeVaultPort();
	for (const path of notes) vault.seedFile(path, "");
	const host = new FakeCommandHost();
	const calendarView = Object.create(CalendarView.prototype) as CalendarView;
	const refresh = vi.spyOn(CalendarView.prototype, "refresh").mockImplementation(() => undefined);

	const plugin = new CalendaricPlugin({} as never, {} as never);
	const ports: PeriodNotePorts = { vault, vaultConfig: new FakeVaultConfigPort(""), workspace: new FakeWorkspacePort() };
	Object.assign(plugin, {
		app: {
			vault: { adapter: {} },
			workspace: { getLeavesOfType: (type: string) => (type === VIEW_TYPE_CALENDAR ? [{ view: calendarView }] : []) },
		},
		loadData: (): Promise<unknown> => Promise.resolve(disk.data),
		saveData: (value: unknown): Promise<void> => {
			if (disk.failNext) {
				disk.failNext = false;
				return Promise.reject(new Error("disk full"));
			}
			disk.data = JSON.parse(JSON.stringify(value)) as unknown;
			disk.writes += 1;
			return Promise.resolve();
		},
		addCommand: (command: Command) => host.addCommand(command),
		removeCommand: (id: string) => host.removeCommand(id),
		notePorts: () => ports,
	});
	await plugin.loadSettings();
	plugin.settings.day.format = "YYYY-MM-DD";
	plugin.settings.day.folder = "Daily";
	await plugin.saveSettings();

	const internals = plugin as unknown as Internals;
	internals.index = new PeriodicNoteIndex(vault, new FakeVaultConfigPort(""), internals.indexConfigs());
	internals.registerGranularityCommands();
	refresh.mockClear();

	return { plugin, internals, disk, vault, host, refresh };
}

async function saveFromTab(plugin: CalendaricPlugin): Promise<void> {
	await plugin.saveSettings();
	plugin.onSettingsChange();
}

function dailyFolderOnDisk(disk: FakeDisk): unknown {
	const stored = disk.data as StoredConfig;
	return stored.calendarSets.find((set) => set.id === stored.activeCalendarSet)?.day?.folder;
}

const at = (date: string) => window.moment(date);

afterEach(() => {
	restoreLocale();
	vi.restoreAllMocks();
	notices.length = 0;
});

describe("US-SET-07: a saved setting takes effect immediately", () => {
	it("AC-SET-07.1: saving a changed folder or format redraws the open calendar view", async () => {
		const { plugin, refresh } = await loadedPlugin();

		plugin.settings.day.folder = "Journal";
		await saveFromTab(plugin);
		expect(refresh).toHaveBeenCalledTimes(1);

		plugin.settings.day.format = "DD-MM-YYYY";
		await saveFromTab(plugin);
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it("AC-SET-07.2: the next lookup finds the note in the newly saved folder, not the startup one", async () => {
		const { plugin, internals } = await loadedPlugin(`Daily/${DATE}.md`, `Journal/${DATE}.md`);
		expect(internals.index?.get("day", at(DATE))?.path).toBe(`Daily/${DATE}.md`);

		plugin.settings.day.folder = "Journal";
		await saveFromTab(plugin);

		expect(internals.index?.get("day", at(DATE))?.path).toBe(`Journal/${DATE}.md`);
	});

	it("AC-SET-07.2: the next created note is written into the newly saved folder", async () => {
		const { plugin, internals, vault } = await loadedPlugin();

		plugin.settings.day.folder = "Journal";
		await saveFromTab(plugin);
		await internals.openPeriodNote("day", at(DATE));

		expect(vault.listNotes().map((file) => file.path)).toEqual([`Journal/${DATE}.md`]);
	});

	it("AC-SET-07.3: enabling or disabling a granularity adds or removes its commands at once", async () => {
		const { plugin, host } = await loadedPlugin();
		expect(host.has("month-open-current")).toBe(false);

		plugin.settings.month.enabled = true;
		await saveFromTab(plugin);
		expect(host.has("month-open-current")).toBe(true);

		plugin.settings.month.enabled = false;
		await saveFromTab(plugin);
		expect(host.has("month-open-current")).toBe(false);
	});
});

describe("AC-SET-07.4: a failed save leaves the plugin on the last saved configuration", () => {
	it("AC-SET-07.4: every field returns to its saved value, and the stored copy is untouched", async () => {
		const { plugin, internals, disk } = await loadedPlugin();
		const saved = structuredClone(plugin.settings);
		const stored = internals.stored;
		const storedBefore = structuredClone(stored);

		plugin.settings.weekStart = "sunday";
		plugin.settings.showPeriodLabel = false;
		for (const granularity of GRANULARITIES) {
			plugin.settings[granularity].folder = `Unsaved/${granularity}`;
			plugin.settings[granularity].enabled = !plugin.settings[granularity].enabled;
		}
		disk.failNext = true;

		await expect(plugin.saveSettings()).rejects.toThrow("disk full");

		expect(plugin.settings).toEqual(saved);
		expect(plugin.settings).toEqual(toSettings(stored));
		expect(internals.stored).toBe(stored);
		expect(internals.stored).toEqual(storedBefore);
	});

	it("AC-SET-07.4: the restore keeps every settings object the calendar and import cards hold", async () => {
		const { plugin, disk } = await loadedPlugin();
		const settings = plugin.settings;
		const configs = GRANULARITIES.map((granularity) => plugin.settings[granularity]);

		plugin.settings.day.folder = "Unsaved";
		disk.failNext = true;
		await expect(plugin.saveSettings()).rejects.toThrow("disk full");

		expect(plugin.settings).toBe(settings);
		expect(GRANULARITIES.map((granularity) => plugin.settings[granularity])).toEqual(configs);
		GRANULARITIES.forEach((granularity, i) => expect(plugin.settings[granularity]).toBe(configs[i]));
		expect(plugin.settings.day.folder).toBe("Daily");
	});

	it("AC-SET-07.4: lookups, creation, commands and the next save never see the half-applied change", async () => {
		const { plugin, internals, disk, vault, host } = await loadedPlugin(`Daily/${DATE}.md`, `Unsaved/${DATE}.md`);

		plugin.settings.day.folder = "Unsaved";
		plugin.settings.month.enabled = true;
		disk.failNext = true;
		await expect(plugin.saveSettings()).rejects.toThrow("disk full");

		// A later, unrelated save rebuilds everything from what is in memory.
		plugin.settings.weekStart = "sunday";
		await saveFromTab(plugin);

		expect(dailyFolderOnDisk(disk)).toBe("Daily");
		expect(internals.index?.get("day", at(DATE))?.path).toBe(`Daily/${DATE}.md`);
		expect(host.has("month-open-current")).toBe(false);

		await internals.openPeriodNote("day", at("2026-04-14"));
		expect(vault.listNotes().map((file) => file.path)).toContain("Daily/2026-04-14.md");
		expect(vault.listNotes().map((file) => file.path)).not.toContain("Unsaved/2026-04-14.md");
	});
});

function toggleNamed(tab: CalendaricSettingsTab, name: string): HTMLInputElement {
	const row = Array.from(tab.containerEl.querySelectorAll(".setting-item")).find(
		(item) => item.querySelector(".setting-item-name")?.textContent === name,
	);
	const input = row?.querySelector("input");
	expect(input).toBeTruthy();
	return input as HTMLInputElement;
}

describe("AC-SET-07.4: a failed save on the settings screen", () => {
	it("AC-SET-07.4: tells the user, and the redrawn screen shows the saved value", async () => {
		const { plugin, disk } = await loadedPlugin();
		const app = plugin.app as unknown as App;
		const tab = new CalendaricSettingsTab(app, plugin, makeSettingsTabPorts(app));
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		tab.display();
		expect(plugin.settings.confirmBeforeCreate).toBe(true);

		const toggle = toggleNamed(tab, "Confirm before creating new note");
		toggle.checked = false;
		disk.failNext = true;
		await toggleHandlers.get(toggle)?.(false);

		expect(notices).toEqual(["Could not save settings."]);
		expect(plugin.settings.confirmBeforeCreate).toBe(true);
		expect(toggleNamed(tab, "Confirm before creating new note").checked).toBe(true);
	});
});

describe("AC-SET-07.4: an import card's failed save", () => {
	it("AC-SET-07.4: the Periodic Notes card still rolls back and shows its own notice", async () => {
		const { plugin, disk } = await loadedPlugin();
		const month = plugin.settings.month;
		const before = structuredClone(month);
		const set: PeriodicNotesCalendarSet = {
			id: "Default",
			granularities: {
				month: { enabled: true, format: "YYYY-MM", folder: "Monthly", templatePath: "", allowPrefixMatch: false },
			},
		};
		const container = document.createElement("div");
		const refresh = vi.fn();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		renderPeriodicNotesImportCard(container, plugin, { readActiveCalendarSet: () => ({ ok: true, value: set }) }, {
			save: () => Promise.resolve(),
			refresh,
		});

		disk.failNext = true;
		container.querySelector("button")?.click();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(notices).toEqual(["Periodic notes import could not be saved."]);
		expect(plugin.settings.month).toBe(month);
		expect(plugin.settings.month).toEqual(before);
		expect(refresh).not.toHaveBeenCalled();
	});
});

describe("a saved change on the settings screen", () => {
	it("AC-SET-07.3: switching a granularity off on the screen removes its commands and redraws the calendar", async () => {
		const { plugin, host, refresh } = await loadedPlugin();
		const app = plugin.app as unknown as App;
		const tab = new CalendaricSettingsTab(app, plugin, makeSettingsTabPorts(app));
		tab.display();
		expect(host.has("week-open-current")).toBe(true);

		const weekly = Array.from(tab.containerEl.querySelectorAll(".periodic-group")).find(
			(group) => group.querySelector(".periodic-group-title span")?.textContent === "Weekly Notes",
		);
		const toggle = weekly?.querySelector(".periodic-group-heading input") as HTMLInputElement;
		expect(toggle).toBeTruthy();
		toggle.checked = false;
		await toggleHandlers.get(toggle)?.(false);

		expect(host.has("week-open-current")).toBe(false);
		expect(refresh).toHaveBeenCalledTimes(1);
	});
});
