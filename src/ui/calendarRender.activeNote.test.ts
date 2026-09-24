// @vitest-environment happy-dom
//
// The active-note highlight and "reveal the active note". A note becomes active
// in another pane by `file-open`, which Obsidian also fires when focus moves
// between leaves that are already open; the fake app below lets each test fire
// it by hand. Paths are computed from the same settings the widget reads, so
// nothing here hardcodes a filename.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { App } from "obsidian";
import { CalendarWidget } from "./calendar";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { DEFAULT_SETTINGS } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";
import { computeNotePath } from "../notes/noteUtils";

const SETTINGS: CalendaricSettings = {
	...DEFAULT_SETTINGS,
	day: { ...DEFAULT_SETTINGS.day, enabled: true, format: "YYYY-MM-DD" },
	week: { ...DEFAULT_SETTINGS.week, enabled: true, format: "gggg-[W]ww" },
	month: { ...DEFAULT_SETTINGS.month, enabled: true, format: "YYYY-MM" },
};

const realMoment = window.moment;

beforeEach(() => {
	window.moment = Object.assign(
		(...args: Parameters<typeof realMoment>) =>
			args.length === 0 ? realMoment("2026-09-14T12:00:00") : realMoment(...args),
		realMoment,
	);
});

afterEach(() => {
	window.moment = realMoment;
});

/** A workspace whose active file the test sets, and whose `file-open` it fires. */
function activeFileApp(): { app: App; open: (path: string | null) => void } {
	const handlers: ((file: { path: string } | null) => void)[] = [];
	let active: { path: string } | null = null;
	const app = {
		workspace: {
			on: (name: string, cb: (file: { path: string } | null) => void): object => {
				if (name === "file-open") handlers.push(cb);
				return {};
			},
			offref: (): undefined => undefined,
			trigger: (): undefined => undefined,
			getActiveFile: () => active,
		},
	} as unknown as App;
	return {
		app,
		open: (path) => {
			active = path === null ? null : { path };
			for (const cb of handlers) cb(active);
		},
	};
}

function setup(settings = SETTINGS): {
	host: HTMLElement;
	widget: CalendarWidget;
	open: (path: string | null) => void;
} {
	const { app, open } = activeFileApp();
	const host = document.createElement("div");
	const widget = new CalendarWidget(host, app, settings, {
		vault: new FakeVaultPort(),
		vaultConfig: new FakeVaultConfigPort(),
		workspace: new FakeWorkspacePort(),
	});
	return { host, widget, open };
}

function notePath(date: string, granularity: "day" | "week" | "month"): string {
	return computeNotePath(window.moment(date), SETTINGS[granularity], new FakeVaultConfigPort());
}

/** The text of every highlighted cell: a day number, or a week number for a row. */
function activeCells(host: HTMLElement): string[] {
	return Array.from(host.querySelectorAll(".is-active")).map((cell) => cell.firstChild?.textContent ?? "");
}

function activeDays(host: HTMLElement): string[] {
	return Array.from(host.querySelectorAll(".calendaric-day.is-active")).map(
		(cell) => cell.firstChild?.textContent ?? "",
	);
}

function activeWeeks(host: HTMLElement): string[] {
	return Array.from(host.querySelectorAll(".calendaric-weeknum.is-active")).map(
		(cell) => cell.firstChild?.textContent ?? "",
	);
}

function header(host: HTMLElement): string {
	return host.querySelector(".calendaric-month-header")?.textContent ?? "";
}

function press(host: HTMLElement, label: "Previous month" | "Next month"): void {
	host.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click();
}

describe("AC-CAL-10.1: the active note's cell is highlighted", () => {
	it("AC-CAL-10.1: a day note opened in another pane highlights its day", () => {
		const { host, open } = setup();
		open(notePath("2026-09-24", "day"));
		expect(activeCells(host)).toEqual(["24"]);
	});

	it("AC-CAL-10.1: a week note opened in another pane highlights its row", () => {
		const { host, open } = setup();
		open(notePath("2026-09-21", "week"));
		expect(activeDays(host)).toEqual([]);
		expect(activeWeeks(host)).toHaveLength(1);
		const row = host.querySelector(".calendaric-weeknum.is-active")?.closest("tr");
		expect(row?.querySelector(".calendaric-day")?.firstChild?.textContent).toBe("21");
	});

	it("AC-CAL-10.1: a day note filed in a subfolder is still its day's note", () => {
		const { host, open } = setup();
		open(`Journal/${notePath("2026-09-24", "day")}`);
		expect(activeCells(host)).toEqual(["24"]);
	});

	it("AC-CAL-10.1: focus moving to another open note moves the highlight", () => {
		const { host, open } = setup();
		open(notePath("2026-09-24", "day"));
		open(notePath("2026-09-02", "day"));
		expect(activeCells(host)).toEqual(["2"]);
	});
});

describe("AC-CAL-10.2: a non-periodic active file clears the highlight", () => {
	it("AC-CAL-10.2: an ordinary note clears the day highlight", () => {
		const { host, open } = setup();
		open(notePath("2026-09-24", "day"));
		open("Projects/todo.md");
		expect(activeCells(host)).toEqual([]);
	});

	it("AC-CAL-10.2: a month note is not a day or week note, so it clears too", () => {
		const { host, open } = setup();
		open(notePath("2026-09-21", "week"));
		open(notePath("2026-09-01", "month"));
		expect(activeCells(host)).toEqual([]);
	});

	it("AC-CAL-10.2: a pane with no file clears the highlight", () => {
		const { host, open } = setup();
		open(notePath("2026-09-24", "day"));
		open(null);
		expect(activeCells(host)).toEqual([]);
	});
});

describe("AC-CAL-10.3: reveal navigates to a note outside the shown month", () => {
	it("AC-CAL-10.3: a day note two months ahead: the view moves there and highlights it", () => {
		const { host, widget, open } = setup();
		open(notePath("2026-11-05", "day"));
		widget.revealActiveNote();
		expect(header(host)).toBe("Nov2026");
		expect(activeCells(host)).toEqual(["5"]);
	});

	it("AC-CAL-10.3: a week note in an earlier month: the view moves there and highlights its row", () => {
		const { host, widget, open } = setup();
		open(notePath("2026-07-13", "week"));
		widget.revealActiveNote();
		expect(header(host)).toBe("Jul2026");
		const row = host.querySelector(".calendaric-weeknum.is-active")?.closest("tr");
		expect(row?.querySelector(".calendaric-day")?.firstChild?.textContent).toBe("13");
	});

	it("AC-CAL-10.3: a day shown only as an adjacent-month cell still navigates to its own month", () => {
		const { host, widget, open } = setup();
		// Sep 2026's grid ends on Sun Oct 4, drawn as an adjacent-month cell.
		open(notePath("2026-10-02", "day"));
		widget.revealActiveNote();
		expect(header(host)).toBe("Oct2026");
		expect(activeCells(host)).toEqual(["2"]);
	});

	it("AC-CAL-10.3: an ISO week on a Wednesday-start grid moves to the month its row starts in", () => {
		const settings: CalendaricSettings = {
			...SETTINGS,
			weekStart: "wednesday",
			week: { ...SETTINGS.week, format: "GGGG-[W]WW" },
		};
		const { host, widget, open } = setup(settings);
		// ISO week Mon Mar 30 – Sun Apr 5 is drawn on the row Wed Apr 1 – Tue Apr 7:
		// in March's grid that row is all adjacent-month cells, so April is the month to show.
		open(computeNotePath(window.moment("2026-03-30"), settings.week, new FakeVaultConfigPort()));
		widget.revealActiveNote();
		expect(header(host)).toBe("Apr2026");
		const row = host.querySelector(".calendaric-weeknum.is-active")?.closest("tr");
		expect(row?.querySelector(".calendaric-day")?.firstChild?.textContent).toBe("1");
	});

	it("AC-CAL-10.3: a month note is no day or week note, so reveal leaves the view where it is", () => {
		const { host, widget, open } = setup();
		open(notePath("2026-11-01", "month"));
		widget.revealActiveNote();
		expect(header(host)).toBe("Sep2026");
	});
});

describe("AC-CAL-10.4: reveal inside the shown month does not navigate", () => {
	it("AC-CAL-10.4: a day note in the month the user stepped to keeps that month", () => {
		const { host, widget, open } = setup();
		press(host, "Next month");
		open(notePath("2026-10-20", "day"));
		widget.revealActiveNote();
		expect(header(host)).toBe("Oct2026");
		expect(activeCells(host)).toEqual(["20"]);
	});

	it("AC-CAL-10.4: a week whose row starts in the previous month but reaches into this one keeps this month", () => {
		const { host, widget, open } = setup();
		// The first row of Sep 2026 runs Mon Aug 31 – Sun Sep 6.
		open(notePath("2026-08-31", "week"));
		widget.revealActiveNote();
		expect(header(host)).toBe("Sep2026");
		const row = host.querySelector(".calendaric-weeknum.is-active")?.closest("tr");
		expect(row?.querySelector(".calendaric-day")?.firstChild?.textContent).toBe("31");
	});
});
