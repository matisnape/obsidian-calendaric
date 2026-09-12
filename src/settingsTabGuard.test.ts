// @vitest-environment happy-dom
//
// AC-ARCH-07.1. The settings tab draws into `containerEl`, an element Obsidian
// owns and reshapes between versions -- an Obsidian 1.13 change to the settings
// dialog is what crashed the Periodic Notes pane and is why this story exists.
// These tests run the real `display()` with one host surface broken and check
// the two things the criterion asks for: the tab still renders, and the broken
// section leaves nothing behind.
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { App } from "obsidian";
import { CalendaricSettingsTab } from "./settings";
import { DEFAULT_SETTINGS } from "./settings/model";
import { ObsidianCompanionPluginAdapter } from "./adapters/obsidianCompanionPluginAdapter";
import type CalendaricPlugin from "./main";

/** Flipped per test, because vi.mock is hoisted once per file. */
let cardBreaks = false;
let settingBreaks = false;

// The import card renders into containerEl through the companion adapter, so it
// stands in for a section that half-draws and then hits a changed host.
vi.mock("./settings/dailyNotesImportCard", () => ({
	renderDailyNotesImportCard: (containerEl: HTMLElement): void => {
		containerEl.createDiv({ cls: "calendaric-test-card" });
		if (cardBreaks) throw new TypeError("Cannot read properties of null (reading 'appendChild')");
	},
}));

// `Setting` is Obsidian's own settings-row builder, used by all three of the
// tab's remaining sections. Breaking it is the closest stand-in for the 1.13
// defect: the host's UI class no longer accepts the element handed to it.
vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	class BreakableSetting extends actual.Setting {
		constructor(container: HTMLElement) {
			super(container);
			if (settingBreaks) throw new TypeError("Obsidian's Setting no longer accepts this element");
		}
	}
	return { ...actual, Setting: BreakableSetting };
});

function makeTab(): CalendaricSettingsTab {
	const app = { vault: { adapter: {} } } as unknown as App;
	const plugin = {
		app,
		settings: structuredClone(DEFAULT_SETTINGS),
		saveSettings: () => Promise.resolve(),
		onSettingsChange: () => undefined,
	} as unknown as CalendaricPlugin;
	// The import card is mocked above, so neither port is reached: what these
	// tests break is the host, not the boundary.
	return new CalendaricSettingsTab(app, plugin, {
		companion: new ObsidianCompanionPluginAdapter(app),
		desktop: { openPluginFile: () => undefined },
	});
}

const warnings = (el: HTMLElement): Element[] => Array.from(el.querySelectorAll(".calendaric-callout--warning"));
const headings = (el: HTMLElement): string[] =>
	Array.from(el.querySelectorAll("h2")).map((h) => h.textContent ?? "");

describe("CalendaricSettingsTab.display", () => {
	beforeEach(() => {
		cardBreaks = false;
		settingBreaks = false;
	});

	it("renders every section while the host is intact", () => {
		const tab = makeTab();
		tab.display();

		expect(headings(tab.containerEl)).toEqual(["General", "Periodic Notes", "Advanced"]);
		expect(tab.containerEl.querySelector(".calendaric-test-card")).not.toBeNull();
		expect(warnings(tab.containerEl)).toHaveLength(0);
	});

	it("AC-ARCH-07.1: skips a section that throws instead of letting the error escape", () => {
		cardBreaks = true;
		const tab = makeTab();

		expect(() => tab.display()).not.toThrow();
	});

	it("AC-ARCH-07.1: leaves nothing half-rendered from the section that threw", () => {
		cardBreaks = true;
		const tab = makeTab();
		tab.display();

		expect(tab.containerEl.querySelector(".calendaric-test-card")).toBeNull();
	});

	it("AC-ARCH-07.1: renders every other section after one of them fails", () => {
		cardBreaks = true;
		const tab = makeTab();
		tab.display();

		expect(headings(tab.containerEl)).toEqual(["General", "Periodic Notes", "Advanced"]);
	});

	it("AC-ARCH-07.1: names the skipped section rather than dropping it silently", () => {
		cardBreaks = true;
		const tab = makeTab();
		tab.display();

		expect(warnings(tab.containerEl)).toHaveLength(1);
		expect(warnings(tab.containerEl)[0]?.textContent).toMatch(/Daily Notes import/);
	});

	// Every section is guarded on its own, not just the first one: breaking a
	// host class all three of the others use must cost three sections and no more.
	it("AC-ARCH-07.1: guards each section separately, not the tab as a whole", () => {
		settingBreaks = true;
		const tab = makeTab();
		tab.display();

		expect(warnings(tab.containerEl)).toHaveLength(3);
		expect(headings(tab.containerEl)).toEqual([]);
		expect(tab.containerEl.querySelector(".calendaric-test-card")).not.toBeNull();
	});
});
