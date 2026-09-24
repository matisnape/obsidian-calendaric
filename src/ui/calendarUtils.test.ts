import { describe, it, expect } from "vitest";
import moment from "moment";
import { getMonthGrid, getWeekAnchor, getWeekdayHeaders, resolveWeekStart } from "./calendarUtils";
import { computeNotePath } from "../notes/noteUtils";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import type { PeriodicConfig } from "../types";

/** The weekly-note format the plugin ships with. */
const WEEK_FORMAT = "gggg-[W]ww";

/**
 * Indexes a grid whose length the compiler cannot know. A missing cell fails the
 * test naming the index, instead of throwing on a property of undefined.
 */
function at<T>(items: readonly T[], index: number): T {
	const item = items[index];
	if (item === undefined) throw new Error(`no grid element at index ${index}`);
	return item;
}


describe("resolveWeekStart", () => {
	it("returns 1 (Monday) for 'monday'", () => {
		expect(resolveWeekStart("monday")).toBe(1);
	});

	it("returns 0 (Sunday) for 'sunday'", () => {
		expect(resolveWeekStart("sunday")).toBe(0);
	});

	it("returns locale default for 'locale'", () => {
		const result = resolveWeekStart("locale");
		expect(typeof result).toBe("number");
		expect(result).toBeGreaterThanOrEqual(0);
		expect(result).toBeLessThanOrEqual(6);
	});
});

describe("getWeekdayHeaders", () => {
	it("returns 7 short day names starting from given weekday", () => {
		const headers = getWeekdayHeaders(1); // Monday start
		expect(headers).toHaveLength(7);
		expect(headers[0]).toBe("Mon");
		expect(headers[6]).toBe("Sun");
	});

	it("handles Sunday start", () => {
		const headers = getWeekdayHeaders(0);
		expect(headers[0]).toBe("Sun");
		expect(headers[6]).toBe("Sat");
	});
});

describe("getMonthGrid", () => {
	it("returns 6 weeks for any month", () => {
		const grid = getMonthGrid(moment("2026-03-15"), 1, WEEK_FORMAT);
		expect(grid).toHaveLength(6);
	});

	it("each week has 7 days", () => {
		const grid = getMonthGrid(moment("2026-03-15"), 1, WEEK_FORMAT);
		grid.forEach((week) => {
			expect(week.days).toHaveLength(7);
		});
	});

	it("marks today correctly", () => {
		const today = moment();
		const grid = getMonthGrid(today, 1, WEEK_FORMAT);
		const todayCell = grid
			.flatMap((w) => w.days)
			.find((d) => d.isToday);
		expect(todayCell).toBeDefined();
		expect(todayCell!.date.isSame(today, "day")).toBe(true);
	});

	it("marks adjacent month days correctly", () => {
		// March 2026 starts on Sunday. With Monday start,
		// first row should have Feb 23-28 (adjacent) + Mar 1
		const grid = getMonthGrid(moment("2026-03-15"), 1, WEEK_FORMAT);
		const firstWeek = at(grid, 0);
		// Feb dates should be adjacent
		const febDays = firstWeek.days.filter(
			(d) => d.date.month() === 1 // February = month 1
		);
		febDays.forEach((d) => {
			expect(d.isAdjacentMonth).toBe(true);
		});
	});

	it("includes correct week numbers", () => {
		const grid = getMonthGrid(moment("2026-03-15"), 1, WEEK_FORMAT);
		grid.forEach((week) => {
			expect(week.weekNumber).toBeGreaterThanOrEqual(1);
			expect(week.weekNumber).toBeLessThanOrEqual(53);
		});
	});

	it("marks weekends correctly for Monday start", () => {
		const grid = getMonthGrid(moment("2026-03-15"), 1, WEEK_FORMAT);
		grid.forEach((week) => {
			// Saturday (index 5) and Sunday (index 6) for Monday start
			expect(at(week.days, 5).isWeekend).toBe(true);
			expect(at(week.days, 6).isWeekend).toBe(true);
			expect(at(week.days, 0).isWeekend).toBe(false); // Monday
		});
	});

	it("first day of grid matches weekStart", () => {
		const grid = getMonthGrid(moment("2026-03-15"), 1, WEEK_FORMAT);
		expect(at(at(grid, 0).days, 0).date.isoWeekday()).toBe(1); // Monday
	});
});

describe("edge cases", () => {
	it("handles February in a leap year", () => {
		const grid = getMonthGrid(moment("2028-02-15"), 1, WEEK_FORMAT); // 2028 is leap year
		const feb29 = grid.flatMap((w) => w.days)
			.find((d) => d.date.date() === 29 && d.date.month() === 1);
		expect(feb29).toBeDefined();
		expect(feb29!.isAdjacentMonth).toBe(false);
	});

	it("handles February in a non-leap year", () => {
		const grid = getMonthGrid(moment("2026-02-15"), 1, WEEK_FORMAT);
		const feb29 = grid.flatMap((w) => w.days)
			.find((d) => d.date.date() === 29 && d.date.month() === 1);
		expect(feb29).toBeUndefined();
	});

	it("handles month starting on weekStart day", () => {
		// June 2026 starts on Monday
		const grid = getMonthGrid(moment("2026-06-01"), 1, WEEK_FORMAT);
		expect(at(at(grid, 0).days, 0).date.date()).toBe(1);
		expect(at(at(grid, 0).days, 0).isAdjacentMonth).toBe(false);
	});

	it("handles Sunday weekStart", () => {
		const grid = getMonthGrid(moment("2026-03-15"), 0, WEEK_FORMAT);
		expect(at(at(grid, 0).days, 0).date.day()).toBe(0); // Sunday
	});

	it("handles December → January year boundary", () => {
		const grid = getMonthGrid(moment("2026-12-15"), 1, WEEK_FORMAT);
		const lastWeek = at(grid, grid.length - 1);
		const janDays = lastWeek.days.filter((d) => d.date.month() === 0);
		janDays.forEach((d) => {
			expect(d.isAdjacentMonth).toBe(true);
			expect(d.date.year()).toBe(2027);
		});
	});
});

function flatten(grid: ReturnType<typeof getMonthGrid>) {
	return grid.flatMap((w) => w.days);
}

describe("AC-CAL-01.1: the grid is a full 6x7 rectangle", () => {
	it("returns 6 rows of 7 days for 24 consecutive months and every week start", () => {
		for (let weekStart = 0; weekStart < 7; weekStart++) {
			const cursor = moment("2026-01-01");
			for (let i = 0; i < 24; i++) {
				const grid = getMonthGrid(cursor, weekStart, WEEK_FORMAT);
				expect(grid).toHaveLength(6);
				grid.forEach((week) => expect(week.days).toHaveLength(7));
				cursor.add(1, "month");
			}
		}
	});

	it("covers 42 consecutive days with no gap or repeat", () => {
		const days = flatten(getMonthGrid(moment("2026-03-15"), 1, WEEK_FORMAT));
		expect(days).toHaveLength(42);
		days.forEach((day, i) => {
			const expected = at(days, 0).date.clone().add(i, "day");
			expect(day.date.format("YYYY-MM-DD")).toBe(expected.format("YYYY-MM-DD"));
		});
	});

	it("still returns 6 rows for a 28-day February that starts on the week start", () => {
		// February 2021 is 28 days long and begins on a Monday, the shortest
		// month a Monday-start grid can hold — 4 weeks of content, 6 rows drawn.
		const grid = getMonthGrid(moment("2021-02-15"), 1, WEEK_FORMAT);
		expect(grid).toHaveLength(6);
		expect(at(at(grid, 0).days, 0).date.format("YYYY-MM-DD")).toBe("2021-02-01");
	});
});

describe("AC-CAL-01.2 / AC-CAL-01.3: adjacent-month days fill the rectangle", () => {
	it("fills the leading cells with the trailing days of the previous month", () => {
		// March 2026 starts on a Sunday, so a Monday-start grid opens on Feb 23.
		const days = flatten(getMonthGrid(moment("2026-03-15"), 1, WEEK_FORMAT));
		const leading = days.slice(0, days.findIndex((d) => !d.isAdjacentMonth));
		expect(leading).toHaveLength(6);
		expect(at(leading, 0).date.format("YYYY-MM-DD")).toBe("2026-02-23");
		expect(at(leading, leading.length - 1).date.format("YYYY-MM-DD")).toBe("2026-02-28");
		leading.forEach((d) => expect(d.isAdjacentMonth).toBe(true));
	});

	it("fills the trailing cells with the leading days of the next month", () => {
		// March 2026 ends on a Tuesday, so the grid runs on to Apr 5.
		const days = flatten(getMonthGrid(moment("2026-03-15"), 1, WEEK_FORMAT));
		const lastOwnIndex = days.map((d) => d.isAdjacentMonth).lastIndexOf(false);
		const trailing = days.slice(lastOwnIndex + 1);
		expect(trailing).toHaveLength(5);
		expect(at(trailing, 0).date.format("YYYY-MM-DD")).toBe("2026-04-01");
		expect(at(trailing, trailing.length - 1).date.format("YYYY-MM-DD")).toBe("2026-04-05");
		trailing.forEach((d) => expect(d.isAdjacentMonth).toBe(true));
	});

	it("marks exactly the displayed month's own days as not adjacent, in order", () => {
		const own = flatten(getMonthGrid(moment("2026-03-15"), 1, WEEK_FORMAT))
			.filter((d) => !d.isAdjacentMonth);
		expect(own).toHaveLength(31);
		own.forEach((d, i) => {
			expect(d.date.format("YYYY-MM-DD")).toBe(`2026-03-${String(i + 1).padStart(2, "0")}`);
		});
	});
});

describe("AC-CAL-01.4: the week number agrees with the weekly note name", () => {
	const weekConfig: PeriodicConfig = {
		enabled: true,
		format: WEEK_FORMAT,
		folder: "Weekly",
		templatePath: "",
		allowPrefixMatch: false,
		openAtStartup: false,
	};
	const vaultConfig = new FakeVaultConfigPort();

	it("matches the weekly note path of every row across the year boundary", () => {
		// December 2026 is the hard case: its fifth row starts Mon 2026-12-28,
		// which the ISO week calls W53 and the locale week calls W01.
		const grid = getMonthGrid(moment("2026-12-15"), 1, WEEK_FORMAT);
		grid.forEach((week) => {
			const path = computeNotePath(at(week.days, 0).date, weekConfig, vaultConfig, "week");
			expect(path).toContain(`W${String(week.weekNumber).padStart(2, "0")}`);
		});
	});

	it("follows the locale week when the weekly note format uses ww", () => {
		const grid = getMonthGrid(moment("2026-12-15"), 1, "gggg-[W]ww");
		const row = grid.find((w) => at(w.days, 0).date.format("YYYY-MM-DD") === "2026-12-28");
		expect(row?.weekNumber).toBe(1);
	});

	it("follows the ISO week when the weekly note format uses WW", () => {
		const grid = getMonthGrid(moment("2026-12-15"), 1, "GGGG-[W]WW");
		const row = grid.find((w) => at(w.days, 0).date.format("YYYY-MM-DD") === "2026-12-28");
		expect(row?.weekNumber).toBe(53);
	});
});

describe("AC-CAL-01.6: dates stay correct across leap years and year boundaries", () => {
	it("keeps 29 February inside a leap-year grid", () => {
		const days = flatten(getMonthGrid(moment("2028-02-15"), 1, WEEK_FORMAT));
		expect(days.find((d) => d.date.format("YYYY-MM-DD") === "2028-02-29")?.isAdjacentMonth)
			.toBe(false);
		expect(days.filter((d) => !d.isAdjacentMonth)).toHaveLength(29);
		expect(at(days, 0).date.format("YYYY-MM-DD")).toBe("2028-01-31");
		expect(at(days, 41).date.format("YYYY-MM-DD")).toBe("2028-03-12");
	});

	it("produces no 29 February in a non-leap year", () => {
		const days = flatten(getMonthGrid(moment("2026-02-15"), 1, WEEK_FORMAT));
		expect(days.find((d) => d.date.format("YYYY-MM-DD") === "2026-02-29")).toBeUndefined();
		expect(days.filter((d) => !d.isAdjacentMonth)).toHaveLength(28);
	});

	it("carries the next year on December's trailing days", () => {
		const days = flatten(getMonthGrid(moment("2026-12-15"), 1, WEEK_FORMAT));
		expect(at(days, 0).date.format("YYYY-MM-DD")).toBe("2026-11-30");
		expect(at(days, 41).date.format("YYYY-MM-DD")).toBe("2027-01-10");
		days.filter((d) => d.date.year() === 2027).forEach((d) => {
			expect(d.isAdjacentMonth).toBe(true);
		});
	});

	it("carries the previous year on January's leading days", () => {
		const days = flatten(getMonthGrid(moment("2027-01-15"), 1, WEEK_FORMAT));
		expect(at(days, 0).date.format("YYYY-MM-DD")).toBe("2026-12-28");
		expect(at(days, 41).date.format("YYYY-MM-DD")).toBe("2027-02-07");
		days.filter((d) => d.date.year() === 2026).forEach((d) => {
			expect(d.isAdjacentMonth).toBe(true);
		});
	});
});

describe("getWeekAnchor", () => {
	it("returns the row's own first day, not the ISO Monday of that day", () => {
		// Sunday-start March 2026: the row runs Sun 03-01 to Sat 03-07, while the
		// ISO Monday of Sun 03-01 is 02-23 — a different week.
		const grid = getMonthGrid(moment("2026-03-15"), 0, WEEK_FORMAT);
		const anchor = getWeekAnchor(at(grid, 0).days);
		expect(anchor.format("YYYY-MM-DD")).toBe("2026-03-01");
		expect(anchor.clone().isoWeekday(1).format("YYYY-MM-DD")).toBe("2026-02-23");
	});

	it("hands back a copy, so a caller cannot mutate the grid", () => {
		const grid = getMonthGrid(moment("2026-03-15"), 1, WEEK_FORMAT);
		getWeekAnchor(at(grid, 0).days).add(10, "day");
		expect(at(at(grid, 0).days, 0).date.format("YYYY-MM-DD")).toBe("2026-02-23");
	});
});

describe("AC-CAL-01.4: one anchor for the number, the dot and the click", () => {
	const weekConfig: PeriodicConfig = {
		enabled: true,
		format: WEEK_FORMAT,
		folder: "Weekly",
		templatePath: "",
		allowPrefixMatch: false,
		openAtStartup: false,
	};
	const vaultConfig = new FakeVaultConfigPort();

	// Every week start, over the December-to-January boundary in both directions,
	// where the ISO week and the locale week name different weeks.
	for (const weekStart of [0, 1, 2, 3, 4, 5, 6]) {
		for (const month of ["2026-12-15", "2027-01-15"]) {
			it(`row anchor matches the displayed number for weekStart=${weekStart}, ${month}`, () => {
				const grid = getMonthGrid(moment(month), weekStart, WEEK_FORMAT);
				grid.forEach((week) => {
					const path = computeNotePath(getWeekAnchor(week.days), weekConfig, vaultConfig, "week");
					expect(path).toContain(`W${String(week.weekNumber).padStart(2, "0")}`);
				});
			});
		}
	}

	it("numbers a Sunday-start row by its own week, not the previous one", () => {
		// The regression the review caught: the ISO Monday of Sun 2026-03-01 is
		// 02-23, so an isoWeekday(1) anchor named the week before the row.
		const grid = getMonthGrid(moment("2026-03-15"), 0, WEEK_FORMAT);
		const row = grid.find((w) => at(w.days, 0).date.format("YYYY-MM-DD") === "2026-03-01");
		const path = computeNotePath(getWeekAnchor(row!.days), weekConfig, vaultConfig, "week");
		expect(row?.weekNumber).toBe(moment("2026-03-01").week());
		expect(path).toContain(`W${String(row!.weekNumber).padStart(2, "0")}`);
	});
});

describe("AC-CAL-01.4: nested-only weekly formats", () => {
	const nestedFormat = "{{monday:GGGG-[W]WW}}";
	const nestedConfig: PeriodicConfig = {
		enabled: true,
		format: nestedFormat,
		folder: "Weekly",
		templatePath: "",
		allowPrefixMatch: false,
		openAtStartup: false,
	};

	it("numbers every row to match the note path a nested-only format writes", () => {
		// Sunday start over the year boundary: the row anchor is a Sunday, whose
		// own locale week and whose ISO Monday's week are different numbers.
		const grid = getMonthGrid(moment("2026-12-15"), 0, nestedFormat);
		grid.forEach((week) => {
			const path = computeNotePath(
				getWeekAnchor(week.days),
				nestedConfig,
				new FakeVaultConfigPort(),
				"week",
			);
			expect(path).toContain(`W${String(week.weekNumber).padStart(2, "0")}`);
		});
	});
});
