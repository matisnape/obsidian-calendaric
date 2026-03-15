import moment from "moment";
import { getMonthGrid, getWeekdayHeaders, resolveWeekStart } from "./calendarUtils";

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
		const grid = getMonthGrid(moment("2026-03-15"), 1);
		expect(grid).toHaveLength(6);
	});

	it("each week has 7 days", () => {
		const grid = getMonthGrid(moment("2026-03-15"), 1);
		grid.forEach((week) => {
			expect(week.days).toHaveLength(7);
		});
	});

	it("marks today correctly", () => {
		const today = moment();
		const grid = getMonthGrid(today, 1);
		const todayCell = grid
			.flatMap((w) => w.days)
			.find((d) => d.isToday);
		expect(todayCell).toBeDefined();
		expect(todayCell!.date.isSame(today, "day")).toBe(true);
	});

	it("marks adjacent month days correctly", () => {
		// March 2026 starts on Sunday. With Monday start,
		// first row should have Feb 23-28 (adjacent) + Mar 1
		const grid = getMonthGrid(moment("2026-03-15"), 1);
		const firstWeek = grid[0];
		// Feb dates should be adjacent
		const febDays = firstWeek.days.filter(
			(d) => d.date.month() === 1 // February = month 1
		);
		febDays.forEach((d) => {
			expect(d.isAdjacentMonth).toBe(true);
		});
	});

	it("includes correct week numbers", () => {
		const grid = getMonthGrid(moment("2026-03-15"), 1);
		grid.forEach((week) => {
			expect(week.weekNumber).toBeGreaterThanOrEqual(1);
			expect(week.weekNumber).toBeLessThanOrEqual(53);
		});
	});

	it("marks weekends correctly for Monday start", () => {
		const grid = getMonthGrid(moment("2026-03-15"), 1);
		grid.forEach((week) => {
			// Saturday (index 5) and Sunday (index 6) for Monday start
			expect(week.days[5].isWeekend).toBe(true);
			expect(week.days[6].isWeekend).toBe(true);
			expect(week.days[0].isWeekend).toBe(false); // Monday
		});
	});

	it("first day of grid matches weekStart", () => {
		const grid = getMonthGrid(moment("2026-03-15"), 1);
		expect(grid[0].days[0].date.isoWeekday()).toBe(1); // Monday
	});
});

describe("edge cases", () => {
	it("handles February in a leap year", () => {
		const grid = getMonthGrid(moment("2028-02-15"), 1); // 2028 is leap year
		const feb29 = grid.flatMap((w) => w.days)
			.find((d) => d.date.date() === 29 && d.date.month() === 1);
		expect(feb29).toBeDefined();
		expect(feb29!.isAdjacentMonth).toBe(false);
	});

	it("handles February in a non-leap year", () => {
		const grid = getMonthGrid(moment("2026-02-15"), 1);
		const feb29 = grid.flatMap((w) => w.days)
			.find((d) => d.date.date() === 29 && d.date.month() === 1);
		expect(feb29).toBeUndefined();
	});

	it("handles month starting on weekStart day", () => {
		// June 2026 starts on Monday
		const grid = getMonthGrid(moment("2026-06-01"), 1);
		expect(grid[0].days[0].date.date()).toBe(1);
		expect(grid[0].days[0].isAdjacentMonth).toBe(false);
	});

	it("handles Sunday weekStart", () => {
		const grid = getMonthGrid(moment("2026-03-15"), 0);
		expect(grid[0].days[0].date.day()).toBe(0); // Sunday
	});

	it("handles December → January year boundary", () => {
		const grid = getMonthGrid(moment("2026-12-15"), 1);
		const lastWeek = grid[grid.length - 1];
		const janDays = lastWeek.days.filter((d) => d.date.month() === 0);
		janDays.forEach((d) => {
			expect(d.isAdjacentMonth).toBe(true);
			expect(d.date.year()).toBe(2027);
		});
	});
});
