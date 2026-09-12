import { describe, it, expect } from "vitest";
import moment from "moment";
import { MonthNavigation } from "./calendarNav";
import { getMonthGrid } from "./calendarUtils";

/** The weekly-note format the plugin ships with. */
const WEEK_FORMAT = "gggg-[W]ww";

/**
 * A navigation whose clock the test owns, plus the count of re-renders it
 * asked for. The count is what settles "activating it has no effect": a
 * control that re-renders has run its handler, whatever the month reads.
 */
function setup(now: string): { nav: MonthNavigation; renders: () => number } {
	let renders = 0;
	const nav = new MonthNavigation(
		() => moment(now),
		() => {
			renders += 1;
		},
	);
	return { nav, renders: () => renders };
}

function shownMonth(nav: MonthNavigation): string {
	return nav.month.format("YYYY-MM");
}

describe("AC-CAL-02.1: the next-month control steps forward one month", () => {
	it("AC-CAL-02.1: shows the following month", () => {
		const { nav, renders } = setup("2026-09-12");

		nav.next();

		expect(shownMonth(nav)).toBe("2026-10");
		expect(renders()).toBe(1);
	});

	it("AC-CAL-02.1: steps out of a 31-day month into a shorter one", () => {
		// A displayed date of the 31st has no counterpart in February. The month
		// is what the grid draws, so the step must not land back on January.
		const { nav } = setup("2027-01-31");

		nav.next();

		expect(shownMonth(nav)).toBe("2027-02");
	});

	it("AC-CAL-02.1: steps forward again from a month it navigated to", () => {
		const { nav } = setup("2026-09-12");

		nav.next();
		nav.next();

		expect(shownMonth(nav)).toBe("2026-11");
	});
});

describe("AC-CAL-02.2: the previous-month control steps back one month", () => {
	it("AC-CAL-02.2: shows the preceding month", () => {
		const { nav, renders } = setup("2026-09-12");

		nav.prev();

		expect(shownMonth(nav)).toBe("2026-08");
		expect(renders()).toBe(1);
	});

	it("AC-CAL-02.2: steps from January back into December of the previous year", () => {
		const { nav } = setup("2027-01-15");

		nav.prev();

		expect(shownMonth(nav)).toBe("2026-12");
	});
});

describe("AC-CAL-02.3: the return-to-today control comes back to the current month", () => {
	it("AC-CAL-02.3: shows the current month again from far away in either direction", () => {
		const { nav } = setup("2026-09-12");

		nav.next();
		nav.next();
		nav.next();
		nav.toToday();
		expect(shownMonth(nav)).toBe("2026-09");

		nav.prev();
		nav.prev();
		nav.toToday();
		expect(shownMonth(nav)).toBe("2026-09");
	});

	it("AC-CAL-02.3: leaves today's cell in the grid it returns to", () => {
		// The real clock here on purpose: `getMonthGrid` marks `isToday` off
		// `window.moment()`, so only the real current month can prove the cell
		// the user came back for is on screen.
		const nav = new MonthNavigation(
			() => window.moment(),
			() => undefined,
		);

		nav.next();
		nav.next();
		nav.toToday();

		const grid = getMonthGrid(nav.month, 1, WEEK_FORMAT);
		const today = grid.flatMap((week) => week.days).filter((day) => day.isToday);
		expect(today).toHaveLength(1);
		expect(today.every((day) => !day.isAdjacentMonth)).toBe(true);
	});
});

describe("AC-CAL-02.4: the return-to-today control is inactive on the current month", () => {
	it("AC-CAL-02.4: reports the inactive state and does nothing when activated", () => {
		const { nav, renders } = setup("2026-09-12");

		// What the control renders its inactive state from.
		expect(nav.atCurrentMonth).toBe(true);

		nav.toToday();

		// And the handler itself is inert: no month change, no re-render.
		expect(shownMonth(nav)).toBe("2026-09");
		expect(renders()).toBe(0);
	});

	it("AC-CAL-02.4: stays inert however many times it is activated", () => {
		const { nav, renders } = setup("2026-09-12");

		nav.toToday();
		nav.toToday();
		nav.toToday();

		expect(renders()).toBe(0);
	});

	it("AC-CAL-02.4: becomes active as soon as the grid leaves the current month", () => {
		const { nav } = setup("2026-09-12");

		nav.next();
		expect(nav.atCurrentMonth).toBe(false);

		nav.prev();
		expect(nav.atCurrentMonth).toBe(true);
	});

	it("AC-CAL-02.4: is inactive on the current month of the right year, not any September", () => {
		const { nav } = setup("2026-09-12");

		nav.next();
		for (let i = 0; i < 11; i++) nav.next();

		expect(shownMonth(nav)).toBe("2027-09");
		expect(nav.atCurrentMonth).toBe(false);
	});
});

describe("AC-CAL-02.5: stepping forward out of December crosses the year", () => {
	it("AC-CAL-02.5: shows January of the following year", () => {
		const { nav } = setup("2026-12-31");

		nav.next();

		expect(shownMonth(nav)).toBe("2027-01");
	});

	it("AC-CAL-02.5: crosses the year from a December it navigated to", () => {
		const { nav } = setup("2026-09-12");

		for (let i = 0; i < 3; i++) nav.next();
		expect(shownMonth(nav)).toBe("2026-12");

		nav.next();
		expect(shownMonth(nav)).toBe("2027-01");
	});
});

describe("MonthNavigation hands out its own month", () => {
	it("does not let a caller move the grid by mutating the month it read", () => {
		const { nav } = setup("2026-09-12");

		nav.month.add(5, "month");

		expect(shownMonth(nav)).toBe("2026-09");
	});
});
