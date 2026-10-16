import { describe, it, expect } from "vitest";
import { stripDays } from "./dayStrip";

const at = (date: string) => window.moment(date);
const SUNDAY = 0;
const MONDAY = 1;

const dates = (days: ReturnType<typeof stripDays>) => days.map((day) => day.date.format("YYYY-MM-DD"));
const marked = (days: ReturnType<typeof stripDays>, key: "isNoteDay" | "isToday") =>
	days.filter((day) => day[key]).map((day) => day.date.format("YYYY-MM-DD"));

describe("stripDays", () => {
	it("AC-CAL-14.1: the seven days of the note's week start on the configured start-of-week day", () => {
		// Sun 2026-04-12 opens a Sunday-start week and closes a Monday-start one.
		const sunday = at("2026-04-12");

		expect(dates(stripDays("day", sunday, "", SUNDAY, at("2026-01-01")))).toEqual([
			"2026-04-12", "2026-04-13", "2026-04-14", "2026-04-15", "2026-04-16", "2026-04-17", "2026-04-18",
		]);
		expect(dates(stripDays("day", sunday, "", MONDAY, at("2026-01-01")))).toEqual([
			"2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10", "2026-04-11", "2026-04-12",
		]);
	});

	it("AC-CAL-14.1: a week note's strip is the week holding its date", () => {
		// A locale week starts where moment's locale says; the plugin sets that to the configured day.
		const days = stripDays("week", at("2026-04-15"), "", SUNDAY, at("2026-01-01"));

		expect(dates(days)[0]).toBe("2026-04-12");
		expect(dates(days)[6]).toBe("2026-04-18");
	});

	it("AC-CAL-14.1: an ISO week under a Sunday start shows the Sunday-start week holding its Monday", () => {
		// ISO week 16 runs Mon 13 to Sun 19 April; the note is filed under the Monday.
		const days = stripDays("week", at("2026-04-19"), "GGGG-[W]WW", SUNDAY, at("2026-01-01"));

		expect(dates(days)[0]).toBe("2026-04-12");
		expect(dates(days)[6]).toBe("2026-04-18");
	});

	it("AC-CAL-14.1: a month or year note's strip is the week holding its first day", () => {
		// 1 April 2026 is a Wednesday; 1 January 2026 a Thursday.
		expect(dates(stripDays("month", at("2026-04-01"), "", MONDAY, at("2026-01-01")))[0]).toBe("2026-03-30");
		expect(dates(stripDays("year", at("2026-01-01"), "", SUNDAY, at("2026-06-01")))[0]).toBe("2025-12-28");
	});

	it("AC-CAL-14.1: a daily note marks its own day; other granularities mark none", () => {
		const now = at("2026-01-01");

		expect(marked(stripDays("day", at("2026-04-15"), "", MONDAY, now), "isNoteDay")).toEqual(["2026-04-15"]);
		expect(marked(stripDays("week", at("2026-04-13"), "", MONDAY, now), "isNoteDay")).toEqual([]);
		expect(marked(stripDays("month", at("2026-04-01"), "", MONDAY, now), "isNoteDay")).toEqual([]);
	});

	it("AC-CAL-14.1: today is marked when it falls in the week, and nothing when it does not", () => {
		const note = at("2026-04-15");

		expect(marked(stripDays("day", note, "", MONDAY, at("2026-04-17T09:30:00")), "isToday")).toEqual(["2026-04-17"]);
		expect(marked(stripDays("day", note, "", MONDAY, at("2026-04-20T09:30:00")), "isToday")).toEqual([]);
	});
});
