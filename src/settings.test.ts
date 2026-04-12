import { describe, it, expect } from "vitest";
import { clearStartupNote, DEFAULT_SETTINGS, CalendaricSettings } from "./settings";

function makeSettings(overrides: Partial<{ [K in "day" | "week" | "month" | "quarter" | "year"]: boolean }>): CalendaricSettings {
	const s: CalendaricSettings = {
		...DEFAULT_SETTINGS,
		day: { ...DEFAULT_SETTINGS.day },
		week: { ...DEFAULT_SETTINGS.week },
		month: { ...DEFAULT_SETTINGS.month },
		quarter: { ...DEFAULT_SETTINGS.quarter },
		year: { ...DEFAULT_SETTINGS.year },
	};
	for (const key of ["day", "week", "month", "quarter", "year"] as const) {
		if (overrides[key] !== undefined) {
			s[key].openAtStartup = overrides[key]!;
		}
	}
	return s;
}

describe("clearStartupNote", () => {
	it("clears openAtStartup on all granularities", () => {
		const settings = makeSettings({ day: true, week: true, month: true, quarter: true, year: true });
		clearStartupNote(settings);
		expect(settings.day.openAtStartup).toBe(false);
		expect(settings.week.openAtStartup).toBe(false);
		expect(settings.month.openAtStartup).toBe(false);
		expect(settings.quarter.openAtStartup).toBe(false);
		expect(settings.year.openAtStartup).toBe(false);
	});

	it("is a no-op when all are already false", () => {
		const settings = makeSettings({});
		clearStartupNote(settings);
		expect(settings.day.openAtStartup).toBe(false);
		expect(settings.week.openAtStartup).toBe(false);
	});

	it("does not change other fields", () => {
		const settings = makeSettings({ day: true });
		clearStartupNote(settings);
		expect(settings.weekStart).toBe("monday");
		expect(settings.day.enabled).toBe(true);
	});
});
