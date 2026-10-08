// @vitest-environment happy-dom
//
// US-CMD-09: at most one note opens when the vault finishes loading. `startUp`
// runs against fakes; the settings cases drive the real "Open on startup"
// toggles and then hand the resulting settings to `startUp`.
import { describe, it, expect, vi } from "vitest";
import type { App, ToggleComponent } from "obsidian";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { CalendaricSettingsTab } from "../settings";
import { DEFAULT_SETTINGS, GRANULARITIES, type CalendaricSettings } from "../settings/model";
import { makeSettingsTabPorts } from "../__mocks__/settingsTabPorts";
import type CalendaricPlugin from "../main";
import { computeNotePath } from "./noteUtils";
import { startUp } from "./periodNoteOpen";

// The shared mock leaves `addToggle` unbuilt; this draws a checkbox and keeps
// its change handler so a test can flip it.
const handlers = new WeakMap<HTMLInputElement, (value: boolean) => unknown>();
vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	class ToggleSetting extends actual.Setting {
		addToggle(cb: (toggle: ToggleComponent) => unknown): this {
			const toggleEl = this.controlEl.createEl("input", { type: "checkbox" });
			cb({
				toggleEl,
				setValue: (value: boolean) => (toggleEl.checked = value),
				setDisabled: (disabled: boolean) => (toggleEl.disabled = disabled),
				onChange: (fn: (value: boolean) => unknown) => handlers.set(toggleEl, fn),
			} as unknown as ToggleComponent);
			return this;
		}
	}
	return { ...actual, Setting: ToggleSetting };
});

const ports = () => ({ vault: new FakeVaultPort(), vaultConfig: new FakeVaultConfigPort(), workspace: new FakeWorkspacePort() });
const date = () => window.moment("2026-04-13");

function settingsWith(...on: Array<(typeof GRANULARITIES)[number]>): CalendaricSettings {
	const settings = structuredClone(DEFAULT_SETTINGS);
	for (const granularity of GRANULARITIES) settings[granularity].enabled = false;
	for (const granularity of on) Object.assign(settings[granularity], { enabled: true, openAtStartup: true });
	return settings;
}

const pathFor = (settings: CalendaricSettings, granularity: "day" | "week", p = ports()) =>
	computeNotePath(date(), settings[granularity], p.vaultConfig, granularity);

function makeTab(settings: CalendaricSettings): CalendaricSettingsTab {
	const app = { vault: { adapter: {} } } as unknown as App;
	const plugin = { app, settings, saveSettings: () => Promise.resolve(), onSettingsChange: () => undefined } as unknown as CalendaricPlugin;
	const tab = new CalendaricSettingsTab(app, plugin, makeSettingsTabPorts(app));
	tab.display();
	return tab;
}

const startupRows = (tab: CalendaricSettingsTab) =>
	Array.from(tab.containerEl.querySelectorAll(".setting-item")).filter(
		(row) => row.querySelector(".setting-item-name")?.textContent === "Open on startup",
	);

describe("US-CMD-09: startUp opens at most one note", () => {
	it("AC-CMD-09.1: with no granularity set to open on startup, nothing opens and nothing is written", async () => {
		const p = ports();
		const settings = settingsWith();
		settings.day.enabled = true;
		settings.week.enabled = true;

		await startUp(settings, date(), p);

		expect(p.workspace.opened).toEqual([]);
		expect(p.vault.getFile(pathFor(settings, "day", p))).toBeNull();
		expect(p.vault.getFile(pathFor(settings, "week", p))).toBeNull();
	});

	it("AC-CMD-09.2: an existing startup note opens in a new tab, and nothing is written", async () => {
		const p = ports();
		const settings = settingsWith("day");
		const path = pathFor(settings, "day", p);
		p.vault.seedFile(path, "already here");
		const existing = p.vault.getFile(path);

		await startUp(settings, date(), p);

		expect(p.workspace.opened).toEqual([{ file: existing, mode: "tab" }]);
		expect(p.vault.contentAt(path)).toBe("already here");
	});

	it("AC-CMD-09.3: a missing startup note is created, then opens in a new tab", async () => {
		const p = ports();
		const settings = settingsWith("week");
		const path = pathFor(settings, "week", p);

		await startUp(settings, date(), p);

		const created = p.vault.getFile(path);
		expect(created).not.toBeNull();
		expect(p.workspace.opened).toEqual([{ file: created, mode: "tab" }]);
	});

	it("AC-CMD-09.5: a startup note restored from the last session is made active, and no new tab is opened", async () => {
		const p = ports();
		const settings = settingsWith("day");
		const path = pathFor(settings, "day", p);
		p.vault.seedFile(path, "restored");
		p.workspace.markOpen(path);

		await startUp(settings, date(), p);

		expect(p.workspace.opened).toEqual([]);
		expect(p.workspace.activated).toEqual([p.vault.getFile(path)]);
	});

	it("AC-CMD-09.5: a different note left open from the last session does not stop the startup note opening", async () => {
		const p = ports();
		const settings = settingsWith("day");
		const path = pathFor(settings, "day", p);
		p.vault.seedFile(path, "not restored");
		p.workspace.markOpen("Daily/some-other-note.md");

		await startUp(settings, date(), p);

		expect(p.workspace.activated).toEqual([]);
		expect(p.workspace.opened).toEqual([{ file: p.vault.getFile(path), mode: "tab" }]);
	});
});

describe("US-CMD-09: the settings that startUp reads", () => {
	it("AC-CMD-09.4: switching week on in the settings tab leaves only week enabled, and startup opens only the week note", async () => {
		const settings = settingsWith("day", "week");
		settings.week.openAtStartup = false;
		const tab = makeTab(settings);
		const [, week] = startupRows(tab).map((row) => row.querySelector("input") as HTMLInputElement);

		week!.checked = true;
		await handlers.get(week!)!(true);

		expect(GRANULARITIES.filter((g) => settings[g].openAtStartup)).toEqual(["week"]);
		const [day] = startupRows(tab).map((row) => row.querySelector("input") as HTMLInputElement);
		expect(day!.checked).toBe(false);

		const p = ports();
		await startUp(settings, date(), p);
		expect(p.workspace.opened.map((entry) => entry.file.path)).toEqual([pathFor(settings, "week", p)]);
	});

	it("AC-CMD-09.6 (reserved quarter): the settings tab offers no 'Open on startup' for quarter", () => {
		const settings = settingsWith("quarter");
		const tab = makeTab(settings);

		const quarterGroup = Array.from(tab.containerEl.querySelectorAll(".periodic-group")).find(
			(group) => group.querySelector(".periodic-group-title span")?.textContent === "Quarterly Notes",
		);
		expect(quarterGroup).toBeDefined();
		expect(Array.from(quarterGroup!.querySelectorAll("input")).every((input) => input.disabled)).toBe(true);
		// Only day and week carry the row at all.
		expect(startupRows(tab)).toHaveLength(2);
	});

	it("AC-CMD-09.6 (reserved quarter): a stored quarter startup flag opens nothing, not even a quarter note that exists", async () => {
		const p = ports();
		const settings = settingsWith("quarter");
		settings.quarter.format = "YYYY-[Q]Q";
		p.vault.seedFile("2026-Q2.md", "a quarter note");

		await startUp(settings, date(), p);

		expect(p.workspace.opened).toEqual([]);
		expect(p.workspace.activated).toEqual([]);
		expect(p.workspace.notices).toEqual([]);
		expect(p.vault.listNotes().map((note) => note.path)).toEqual(["2026-Q2.md"]);
	});

	it("AC-CMD-09.6 (not enabled): a startup flag on a switched-off granularity opens and writes nothing", async () => {
		const p = ports();
		const settings = settingsWith("day");
		settings.day.enabled = false;

		await startUp(settings, date(), p);

		expect(p.workspace.opened).toEqual([]);
		expect(p.vault.getFile(pathFor(settings, "day", p))).toBeNull();
	});
});
