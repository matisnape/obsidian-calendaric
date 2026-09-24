// @vitest-environment happy-dom
//
// US-SET-05: only one granularity opens at startup. These tests drive the real
// "Open on startup" toggles through `display()` and read the redrawn screen, so
// they prove what the user sees, not only the stored flags.
import { describe, it, expect, vi } from "vitest";
import type { App, ToggleComponent } from "obsidian";
import { CalendaricSettingsTab } from "./settings";
import { DEFAULT_SETTINGS, GRANULARITIES, loadStoredConfig, toSettings, type CalendaricSettings } from "./settings/model";
import { makeSettingsTabPorts } from "./__mocks__/settingsTabPorts";
import type CalendaricPlugin from "./main";

// The shared mock leaves `addToggle` unbuilt. This file needs the control, so it
// draws a checkbox and keeps its change handler to call when a test flips it.
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

function makeTab(settings: CalendaricSettings) {
	const app = { vault: { adapter: {} } } as unknown as App;
	const saveSettings = vi.fn(() => Promise.resolve());
	const plugin = { app, settings, saveSettings, onSettingsChange: () => undefined } as unknown as CalendaricPlugin;
	const tab = new CalendaricSettingsTab(app, plugin, makeSettingsTabPorts(app));
	tab.display();
	return { tab, saveSettings };
}

/** The "Open on startup" checkboxes on screen now, in render order: day, week. */
function startupToggles(tab: CalendaricSettingsTab): { day: HTMLInputElement; week: HTMLInputElement } {
	const [day, week] = Array.from(tab.containerEl.querySelectorAll(".setting-item"))
		.filter((row) => row.querySelector(".setting-item-name")?.textContent === "Open on startup")
		.map((row) => row.querySelector("input") as HTMLInputElement);
	return { day: day!, week: week! };
}

async function flip(toggle: HTMLInputElement): Promise<void> {
	toggle.checked = !toggle.checked;
	await handlers.get(toggle)!(toggle.checked);
}

const badges = (tab: CalendaricSettingsTab): string[] =>
	Array.from(tab.containerEl.querySelectorAll(".periodic-group-title"))
		.filter((title) => title.querySelector(".badge"))
		.map((title) => title.querySelector("span")?.textContent ?? "");

const flagsOn = (settings: CalendaricSettings) => GRANULARITIES.filter((g) => settings[g].openAtStartup);

function settingsWith(...on: Array<"day" | "week">): CalendaricSettings {
	const settings = structuredClone(DEFAULT_SETTINGS);
	for (const granularity of on) settings[granularity].openAtStartup = true;
	return settings;
}

describe("US-SET-05: Open on startup is exclusive", () => {
	it("AC-SET-05.1: switching B on switches A off and the redrawn screen shows A off", async () => {
		const settings = settingsWith("day");
		const { tab } = makeTab(settings);

		await flip(startupToggles(tab).week);

		expect(flagsOn(settings)).toEqual(["week"]);
		expect(startupToggles(tab).day.checked).toBe(false);
		expect(startupToggles(tab).week.checked).toBe(true);
		expect(badges(tab)).toEqual(["Weekly Notes"]);
	});

	it("AC-SET-05.2: switching one on with none on leaves only that one on", async () => {
		const settings = settingsWith();
		const { tab } = makeTab(settings);

		await flip(startupToggles(tab).day);

		expect(flagsOn(settings)).toEqual(["day"]);
	});

	it("AC-SET-05.3: switching one off changes no other granularity", async () => {
		const settings = settingsWith("day", "week");
		const { tab } = makeTab(settings);

		await flip(startupToggles(tab).week);

		expect(flagsOn(settings)).toEqual(["day"]);
		expect(startupToggles(tab).day.checked).toBe(true);
	});

	it("AC-SET-05.4: a stored config with two flags on loads and displays both, rewriting nothing", () => {
		const group = { id: "Default", day: { openAtStartup: true }, week: { openAtStartup: true } };
		const settings = toSettings(loadStoredConfig({ calendarSets: [group], activeCalendarSet: "Default" }));
		const { tab, saveSettings } = makeTab(settings);

		expect(flagsOn(settings)).toEqual(["day", "week"]);
		expect(startupToggles(tab).day.checked).toBe(true);
		expect(startupToggles(tab).week.checked).toBe(true);
		expect(badges(tab)).toEqual(["Daily Notes", "Weekly Notes"]);
		expect(saveSettings).not.toHaveBeenCalled();
	});

	it("AC-SET-05.4: from two flags on, the next switch-on leaves only that one on", async () => {
		const settings = settingsWith("day", "week");
		const { tab } = makeTab(settings);

		await flip(startupToggles(tab).week);
		await flip(startupToggles(tab).week);

		expect(flagsOn(settings)).toEqual(["week"]);
		expect(startupToggles(tab).day.checked).toBe(false);
	});
});
