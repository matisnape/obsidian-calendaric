// @vitest-environment happy-dom
//
// The Calendar plugin import as the user meets it: the real settings tab and
// the real adapters, over a minimal host that carries a fake Calendar plugin.
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { CalendaricSettingsTab } from "./settings";
import { DEFAULT_SETTINGS } from "./settings/model";
import type { CalendaricSettings } from "./settings/model";
import { makeSettingsTabPorts } from "./__mocks__/settingsTabPorts";
import { CalendarImportConflictModal } from "./settings/calendarImportModal";
import type { CalendarImportField, CalendarImportFieldId } from "./settings/calendarImport";
import type CalendaricPlugin from "./main";

function makeApp(plugins: Record<string, unknown>): App {
	return {
		vault: { adapter: {} },
		plugins: { getPlugin: (id: string) => plugins[id] ?? null },
		internalPlugins: { getPluginById: () => null },
	} as unknown as App;
}

function render(plugins: Record<string, unknown>, settings: CalendaricSettings = structuredClone(DEFAULT_SETTINGS)) {
	const app = makeApp(plugins);
	const plugin = {
		app,
		settings,
		saveSettings: () => Promise.resolve(),
		onSettingsChange: () => undefined,
	} as unknown as CalendaricPlugin;
	const tab = new CalendaricSettingsTab(app, plugin, makeSettingsTabPorts(app));
	tab.display();
	return tab.containerEl;
}

const calendarCard = (el: HTMLElement) =>
	Array.from(el.querySelectorAll(".calendaric-callout")).find((card) =>
		card.textContent?.includes("Calendar plugin"),
	);

const AC_03_7_OPTIONS = {
	shouldConfirmBeforeCreate: true,
	weekStart: "monday",
	wordsPerDot: 250,
	showWeeklyNote: true,
	localeOverride: "system-default",
	weeklyNoteFormat: "",
	weeklyNoteTemplate: "",
	weeklyNoteFolder: "",
};

describe("the Calendar plugin import card in the settings tab", () => {
	it("AC-MIG-03.6: is not offered when the Calendar plugin is not installed or not enabled", () => {
		expect(calendarCard(render({}))).toBeUndefined();
	});

	it("AC-MIG-03.7: is offered for the criterion's fixture, with an import button", () => {
		const card = calendarCard(render({ calendar: { options: AC_03_7_OPTIONS } }));

		expect(card?.textContent).toContain("Calendar plugin detected");
		expect(Array.from(card?.querySelectorAll("button") ?? []).map((b) => b.textContent)).toEqual(["Import settings"]);
	});

	it("AC-MIG-03.8: is not offered when every field the importer reads is unset", () => {
		expect(calendarCard(render({ calendar: { options: {} } }))).toBeUndefined();
	});

	it("AC-MIG-03.4: importing stores the Calendar plugin's words per dot", async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.wordsPerDot = 400;
		const card = calendarCard(render({ calendar: { options: { wordsPerDot: 250 } } }, settings));

		card?.querySelector("button")?.click();
		await Promise.resolve();

		expect(settings.wordsPerDot).toBe(250);
	});
});

describe("CalendarImportConflictModal", () => {
	const conflicts: CalendarImportField[] = [
		{ id: "week.folder", label: "Weekly note folder", value: "Theirs", current: "Mine", incoming: "Theirs" },
	];

	function open(onConfirm: (confirmed: CalendarImportFieldId[]) => Promise<void>): HTMLElement {
		const modal = new CalendarImportConflictModal({} as App, conflicts, onConfirm);
		modal.onOpen();
		return modal.contentEl;
	}

	const button = (el: HTMLElement, label: string) =>
		Array.from(el.querySelectorAll("button")).find((b) => b.textContent === label);

	it("AC-MIG-03.5: shows the incoming value next to the user's current value", () => {
		const row = open(() => Promise.resolve()).querySelector(".calendaric-import-conflict");

		expect(row?.textContent).toContain('yours: "Mine"');
		expect(row?.textContent).toContain('Calendar plugin: "Theirs"');
	});

	it("AC-MIG-03.5: replaces nothing unless the value is ticked", () => {
		const calls: CalendarImportFieldId[][] = [];
		const el = open(async (confirmed) => {
			calls.push(confirmed);
		});

		button(el, "Import selected")?.click();
		el.querySelector<HTMLInputElement>("input")!.checked = true;
		button(el, "Import selected")?.click();

		expect(calls).toEqual([[], ["week.folder"]]);
	});
});
