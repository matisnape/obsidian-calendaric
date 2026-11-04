import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { ObsidianCalendarPluginAdapter } from "./obsidianCalendarPluginAdapter";

function makeApp(plugins: Record<string, unknown>): App {
	return { plugins: { getPlugin: (id: string) => plugins[id] ?? null } } as unknown as App;
}

const read = (plugins: Record<string, unknown>) =>
	new ObsidianCalendarPluginAdapter(makeApp(plugins)).readCalendarSettings();

describe("ObsidianCalendarPluginAdapter.readCalendarSettings", () => {
	it("AC-MIG-03.1: reads the Calendar plugin's weekly note and display settings from its options", () => {
		const options = {
			weekStart: "sunday",
			shouldConfirmBeforeCreate: false,
			showWeeklyNote: true,
			wordsPerDot: 250,
			localeOverride: "pl",
			weeklyNoteFormat: "gggg-ww",
			weeklyNoteFolder: "Weekly",
			weeklyNoteTemplate: "Week.md",
		};

		expect(read({ calendar: { options } })).toEqual({ ok: true, value: options });
	});

	it("AC-MIG-03.1: prefers the development build of the Calendar plugin", () => {
		expect(
			read({ "calendar-anks": { options: { weekStart: "monday" } }, calendar: { options: { weekStart: "sunday" } } }),
		).toEqual({ ok: true, value: { weekStart: "monday" } });
	});

	it("AC-MIG-03.6: a Calendar plugin that is not installed or not enabled reads as absent", () => {
		// Obsidian's registry answers for loaded plugins only, so both cases look like this.
		const result = read({});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("absent");
	});

	it("AC-MIG-03.8: a key the plugin does not carry stays out, with no default filled in", () => {
		expect(read({ calendar: { options: { weeklyNoteFormat: "", unrelated: 1 } } })).toEqual({
			ok: true,
			value: { weeklyNoteFormat: "" },
		});
	});

	it("reports a mismatch when a key holds a value of the wrong type", () => {
		const result = read({ calendar: { options: { wordsPerDot: "250" } } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("mismatch");
		expect(result.problem).toContain("wordsPerDot");
	});

	it("reports a mismatch when the plugin has no options object", () => {
		const result = read({ calendar: {} });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("mismatch");
	});

	it("never writes into the Calendar plugin's settings", () => {
		const options = Object.freeze({ weekStart: "monday", weeklyNoteFormat: "" });
		const plugin = {
			options,
			writeOptions: () => {
				throw new Error("the import wrote to the Calendar plugin");
			},
			saveData: () => {
				throw new Error("the import saved the Calendar plugin's data");
			},
		};

		expect(read({ calendar: plugin }).ok).toBe(true);
		expect(plugin.options).toBe(options);
	});
});
