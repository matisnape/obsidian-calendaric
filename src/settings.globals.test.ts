// @vitest-environment happy-dom
//
// US-SET-02: settings that belong to the whole plugin sit in their own area of
// the settings screen, are stored once, and open on their documented defaults.
// Every assertion reads the rendered tab, after the DOM events a user produces.
import { describe, it, expect, vi } from "vitest";
import type { App, DropdownComponent, TextComponent, ToggleComponent } from "obsidian";
import { CalendaricSettingsTab } from "./settings";
import { applySettings, loadStoredConfig, toSettings, type StoredConfig } from "./settings/model";
import { makeSettingsTabPorts } from "./__mocks__/settingsTabPorts";
import type CalendaricPlugin from "./main";

// The shared `Setting` mock leaves its controls unbuilt. This file builds the
// part of each one the tab uses, as a real element, so a test can read back the
// value a control shows and change it the way a user does.
vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	class ControlSetting extends actual.Setting {
		addText(cb: (text: TextComponent) => unknown): this {
			const inputEl = this.controlEl.createEl("input", { attr: { type: "text" } });
			const text = {
				inputEl,
				setPlaceholder: (value: string) => ((inputEl.placeholder = value), text),
				setValue: (value: string) => ((inputEl.value = value), text),
				onChange: (handler: (value: string) => unknown) => {
					inputEl.addEventListener("input", () => handler(inputEl.value));
					return text;
				},
			};
			cb(text as unknown as TextComponent);
			return this;
		}
		addToggle(cb: (toggle: ToggleComponent) => unknown): this {
			const toggleEl = this.controlEl.createEl("input", { attr: { type: "checkbox" } });
			const toggle = {
				toggleEl,
				setValue: (value: boolean) => ((toggleEl.checked = value), toggle),
				setDisabled: (value: boolean) => ((toggleEl.disabled = value), toggle),
				onChange: (handler: (value: boolean) => unknown) => {
					toggleEl.addEventListener("change", () => handler(toggleEl.checked));
					return toggle;
				},
			};
			cb(toggle as unknown as ToggleComponent);
			return this;
		}
		addDropdown(cb: (dd: DropdownComponent) => unknown): this {
			const selectEl = this.controlEl.createEl("select");
			const dd = {
				selectEl,
				addOption: (value: string, label: string) => {
					selectEl.createEl("option", { text: label, attr: { value } });
					return dd;
				},
				setValue: (value: string) => ((selectEl.value = value), dd),
				onChange: (handler: (value: string) => unknown) => {
					selectEl.addEventListener("change", () => handler(selectEl.value));
					return dd;
				},
			};
			cb(dd as unknown as DropdownComponent);
			return this;
		}
	}
	return { ...actual, Setting: ControlSetting };
});

function makeApp(): App {
	return {
		vault: { adapter: {} },
		internalPlugins: {
			getPluginById: () => ({ enabled: false, disable: () => undefined, instance: { options: {} } }),
		},
	} as unknown as App;
}

/** Render the tab over `raw` as `loadData()` would return it; saves go through `applySettings` and JSON. */
function renderTab(raw: unknown = undefined) {
	const app = makeApp();
	const plugin = {
		app,
		stored: loadStoredConfig(raw),
		settings: toSettings(loadStoredConfig(raw)),
		saved: undefined as unknown,
		saveSettings(): Promise<void> {
			this.saved = JSON.parse(JSON.stringify(applySettings(this.stored, this.settings)));
			this.stored = loadStoredConfig(this.saved);
			return Promise.resolve();
		},
		onSettingsChange: () => undefined,
	};
	const tab = new CalendaricSettingsTab(app, plugin as unknown as CalendaricPlugin, makeSettingsTabPorts(app));
	tab.display();
	// A control this file failed to build would throw inside a section and be
	// swapped for a warning, which reads as "nothing wrong" to every check below.
	expect(tab.containerEl.querySelector(".calendaric-callout--warning")).toBeNull();
	expect(tab.containerEl.querySelectorAll(".periodic-group").length).toBeGreaterThan(0);
	return { tab, plugin };
}

function row(tab: CalendaricSettingsTab, name: string): HTMLElement {
	const found = Array.from(tab.containerEl.querySelectorAll<HTMLElement>(".setting-item")).find(
		(el) => el.querySelector(".setting-item-name")?.textContent === name,
	);
	if (!found) throw new Error(`no settings row named ${name}`);
	return found;
}

const GLOBAL_ROWS = [
	"Start week on",
	"Confirm before creating new note",
	"Show week numbers",
	"Show period label",
	"Words per dot",
	"Override locale",
];

function threshold(tab: CalendaricSettingsTab) {
	const el = row(tab, "Words per dot");
	return {
		input: el.querySelector("input") as HTMLInputElement,
		problem: () => el.querySelector(".calendaric-setting-problem")?.textContent ?? "",
	};
}

function enter(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event("input"));
	input.dispatchEvent(new Event("change"));
	input.dispatchEvent(new Event("blur"));
}

describe("US-SET-02 global settings", () => {
	it("AC-SET-02.1: every global setting sits in one of the two global areas, which hold no granularity group", () => {
		const { tab } = renderTab();
		// General at the top, Advanced at the bottom: the section order is pinned elsewhere (AC-ARCH-07.1).
		const areas = Array.from(tab.containerEl.querySelectorAll(".calendaric-global-settings"));
		expect(areas).toHaveLength(2);

		for (const name of GLOBAL_ROWS) {
			const el = row(tab, name);
			expect(el.closest(".calendaric-global-settings"), name).not.toBeNull();
			expect(el.closest(".periodic-group"), name).toBeNull();
		}
		for (const area of areas) {
			expect(area.querySelector(".periodic-group")).toBeNull();
			expect(area.closest(".periodic-group")).toBeNull();
		}
		// No granularity's own row is drawn inside a global area.
		for (const group of Array.from(tab.containerEl.querySelectorAll(".periodic-group"))) {
			expect(group.closest(".calendaric-global-settings")).toBeNull();
		}
	});

	it("AC-SET-02.2: changing a global on the screen stores it once, at the top level", () => {
		const { tab, plugin } = renderTab();
		enter(threshold(tab).input, "400");

		const text = JSON.stringify(plugin.saved);
		expect(text.match(/"wordsPerDot"/g)).toHaveLength(1);
		expect((plugin.saved as StoredConfig).wordsPerDot).toBe(400);
		for (const set of (plugin.saved as StoredConfig).calendarSets) {
			expect(JSON.stringify(set)).not.toContain("wordsPerDot");
		}
	});

	it("AC-SET-02.3: a fresh install shows every global's documented default, none blank", () => {
		const { tab } = renderTab();
		const select = (name: string) => row(tab, name).querySelector("select") as HTMLSelectElement;
		const toggle = (name: string) => (row(tab, name).querySelector("input") as HTMLInputElement).checked;

		expect(select("Start week on").value).toBe("monday");
		expect(select("Start week on").selectedOptions[0]?.textContent).toBe("Monday");
		expect(toggle("Confirm before creating new note")).toBe(true);
		expect(toggle("Show week numbers")).toBe(true);
		expect(toggle("Show period label")).toBe(true);
		expect(threshold(tab).input.value).toBe("250");
		// The locale default is the empty value, drawn as a named option rather than a blank.
		expect(select("Override locale").value).toBe("");
		expect(select("Override locale").selectedOptions[0]?.textContent).toBe("Same as Obsidian");
	});

	it("AC-SET-02.4: the word-count threshold control is among the global settings and shows 250 on a fresh install", () => {
		const { tab } = renderTab();
		const el = row(tab, "Words per dot");
		expect(el.closest(".calendaric-global-settings")).not.toBeNull();
		expect(threshold(tab).input.value).toBe("250");
		expect(threshold(tab).problem()).toBe("");
	});

	it("AC-SET-02.5: a threshold that is not a positive whole number is stored as 250, and the field says so", () => {
		for (const entry of ["0", "-5", "abc", "2.5", "", "1e3", "0x10"]) {
			const { tab, plugin } = renderTab({ wordsPerDot: 100 });
			const field = threshold(tab);
			expect(field.input.value).toBe("100");

			enter(field.input, entry);

			expect((plugin.saved as StoredConfig).wordsPerDot, `entered "${entry}"`).toBe(250);
			expect(plugin.settings.wordsPerDot, `entered "${entry}"`).toBe(250);
			expect(field.problem(), `entered "${entry}"`).toContain("250");

			enter(field.input, "300");
			expect((plugin.saved as StoredConfig).wordsPerDot).toBe(300);
			expect(field.problem()).toBe("");
		}
	});
});

// US-SET-08: monthly and yearly notes get the same editable group as daily and weekly.
function group(tab: CalendaricSettingsTab, label: string): HTMLElement {
	const found = Array.from(tab.containerEl.querySelectorAll<HTMLElement>(".periodic-group")).find(
		(el) => el.querySelector(".periodic-group-title > span")?.textContent === label,
	);
	if (!found) throw new Error(`no group named ${label}`);
	return found;
}

const enableToggle = (el: HTMLElement) =>
	el.querySelector(".periodic-group-heading .setting-item-control input") as HTMLInputElement;

const fieldNames = (el: HTMLElement) =>
	Array.from(el.querySelectorAll(".periodic-group-content .setting-item-name")).map((name) => name.textContent);

const fieldsOf = (adjective: string) => [
	"Format",
	"Note folder",
	`${adjective} Note Template`,
	"Allow prefix matching",
	"Open on startup",
];

describe("US-SET-08 monthly and yearly settings", () => {
	it("AC-SET-08.1: the Monthly and Yearly Notes toggles switch on, and the groups offer the daily and weekly fields", () => {
		expect(fieldNames(group(renderTab().tab, "Daily Notes"))).toEqual(fieldsOf("Daily"));
		expect(fieldNames(group(renderTab().tab, "Weekly Notes"))).toEqual(fieldsOf("Weekly"));

		for (const [label, adjective, id] of [
			["Monthly Notes", "Monthly", "month"],
			["Yearly Notes", "Yearly", "year"],
		] as const) {
			const { tab, plugin } = renderTab();
			expect(fieldNames(group(tab, label))).toEqual(fieldsOf(adjective));
			// A fresh tab shows the default format with no problem line under it.
			expect(group(tab, label).querySelector(".calendaric-setting-problem")?.textContent).toBe("");

			const toggle = enableToggle(group(tab, label));
			expect(toggle.disabled).toBe(false);
			toggle.checked = true;
			toggle.dispatchEvent(new Event("change"));

			expect(plugin.settings[id].enabled).toBe(true);
			const stored = plugin.saved as StoredConfig;
			expect(stored.calendarSets.find((set) => set.id === stored.activeCalendarSet)?.[id]?.enabled).toBe(true);
		}
	});

	it("AC-SET-08.4: neither month nor year is a placeholder, and quarter stays a locked placeholder in registry order", () => {
		const { tab } = renderTab();
		const titles = Array.from(tab.containerEl.querySelectorAll(".periodic-group-title > span")).map((el) => el.textContent);
		expect(titles).toEqual(["Daily Notes", "Weekly Notes", "Monthly Notes", "Quarterly Notes", "Yearly Notes", "Custom Notes"]);

		for (const label of ["Monthly Notes", "Yearly Notes"]) {
			expect(enableToggle(group(tab, label)).disabled, label).toBe(false);
			expect(group(tab, label).querySelector(".periodic-group-content"), label).not.toBeNull();
		}
		for (const label of ["Quarterly Notes", "Custom Notes"]) {
			expect(enableToggle(group(tab, label)).disabled, label).toBe(true);
			expect(enableToggle(group(tab, label)).checked, label).toBe(false);
			expect(group(tab, label).querySelector(".periodic-group-content"), label).toBeNull();
		}
	});
});
