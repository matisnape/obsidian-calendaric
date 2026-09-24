import { describe, it, expect } from "vitest";
import { getMonthGrid } from "./calendarUtils";
import type { ICalendarMonth } from "../types";

const moment = window.moment;
const WEEK_FORMAT = "gggg-[W]ww";
const MONDAY = 1;
const SUNDAY = 0;

const rows = (grid: ICalendarMonth): string[][] =>
	grid.map((week) => week.days.map((day) => day.date.format("YYYY-MM-DD")));
const shape = (grid: ICalendarMonth): number[] => grid.map((week) => week.days.length);

describe("getMonthGrid: configured week start", () => {
	// May 2026 opens on a Friday, so both conventions need leading April days.
	it("AC-FMT-02.1: a Monday start gives 6 rows of 7 days, every row opening on a Monday", () => {
		const grid = getMonthGrid(moment("2026-05-15"), MONDAY, WEEK_FORMAT);
		expect(shape(grid)).toEqual([7, 7, 7, 7, 7, 7]);
		expect(grid.map((week) => week.days[0]!.date.day())).toEqual([1, 1, 1, 1, 1, 1]);
		expect(rows(grid)[0]![0]).toBe("2026-04-27");
		expect(rows(grid)[5]![6]).toBe("2026-06-07");
		expect(grid[0]!.days.filter((day) => day.isAdjacentMonth)).toHaveLength(4);
	});

	it("AC-FMT-02.2: a Sunday start opens every row on a Sunday, one day earlier than the Monday grid", () => {
		const sunday = getMonthGrid(moment("2026-05-15"), SUNDAY, WEEK_FORMAT);
		const monday = getMonthGrid(moment("2026-05-15"), MONDAY, WEEK_FORMAT);
		expect(shape(sunday)).toEqual([7, 7, 7, 7, 7, 7]);
		expect(sunday.map((week) => week.days[0]!.date.day())).toEqual([0, 0, 0, 0, 0, 0]);
		expect(rows(sunday).map((row) => row[0])).toEqual([
			"2026-04-26", "2026-05-03", "2026-05-10", "2026-05-17", "2026-05-24", "2026-05-31",
		]);
		expect(rows(sunday)[0]).not.toEqual(rows(monday)[0]);
	});

	it("AC-FMT-02.3: a month opening on the week-start day still gets 6 rows, the last one all next month", () => {
		// June 2026 opens on a Monday, March 2026 on a Sunday; each fills exactly 5 rows by itself.
		for (const [month, weekStart, first, lastRow] of [
			["2026-06-10", MONDAY, "2026-06-01", ["2026-07-06", "2026-07-12"]],
			["2026-03-10", SUNDAY, "2026-03-01", ["2026-04-05", "2026-04-11"]],
		] as const) {
			const grid = getMonthGrid(moment(month), weekStart, WEEK_FORMAT);
			expect(shape(grid)).toEqual([7, 7, 7, 7, 7, 7]);
			expect(rows(grid)[0]![0]).toBe(first);
			expect([rows(grid)[5]![0], rows(grid)[5]![6]]).toEqual(lastRow);
			expect(grid[5]!.days.every((day) => day.isAdjacentMonth)).toBe(true);
		}
	});

	it("AC-FMT-02.4: the caller's displayed-month moment is left untouched", () => {
		const displayed = moment("2026-05-17T13:45:00");
		const before = displayed.valueOf();
		getMonthGrid(displayed, MONDAY, WEEK_FORMAT);
		getMonthGrid(displayed, SUNDAY, WEEK_FORMAT);
		expect(displayed.valueOf()).toBe(before);
	});

	it("AC-FMT-02.5: December's trailing days carry the next year, in a 6×7 grid", () => {
		const grid = getMonthGrid(moment("2026-12-15"), MONDAY, WEEK_FORMAT);
		expect(shape(grid)).toEqual([7, 7, 7, 7, 7, 7]);
		const trailing = grid.flatMap((week) => week.days).filter((day) => day.date.month() === 0);
		expect(trailing.map((day) => day.date.format("YYYY-MM-DD"))).toEqual([
			"2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04", "2027-01-05",
			"2027-01-06", "2027-01-07", "2027-01-08", "2027-01-09", "2027-01-10",
		]);
	});
});
