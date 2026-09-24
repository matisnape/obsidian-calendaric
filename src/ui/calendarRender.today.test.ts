// @vitest-environment happy-dom
//
// The pane left open across midnight. `CalendarView` calls `refresh()` on a
// 60-second interval; these tests call it directly after moving the clock, so
// nothing here waits on a real timer.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { App } from "obsidian";
import { CalendarWidget } from "./calendar";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { DEFAULT_SETTINGS } from "../settings/model";

/**
 * The widget reads the clock as `window.moment()`, so that call is the one the
 * test owns: with no arguments it answers `clock`, with arguments it parses as
 * usual.
 */
let clock = "";
const realMoment = window.moment;

beforeEach(() => {
	window.moment = Object.assign(
		(...args: Parameters<typeof realMoment>) =>
			args.length === 0 ? realMoment(clock) : realMoment(...args),
		realMoment,
	);
});

afterEach(() => {
	window.moment = realMoment;
});

function eventOnlyApp(): App {
	return {
		workspace: {
			on: (): object => ({}),
			offref: (): undefined => undefined,
			trigger: (): undefined => undefined,
		},
	} as unknown as App;
}

/** Opens the pane at `now`; `tick(later)` is the interval firing at `later`. */
function openAt(now: string): { host: HTMLElement; tick: (later: string) => void } {
	clock = now;
	const host = document.createElement("div");
	const widget = new CalendarWidget(host, eventOnlyApp(), DEFAULT_SETTINGS, {
		vault: new FakeVaultPort(),
		vaultConfig: new FakeVaultConfigPort(),
		workspace: new FakeWorkspacePort(),
	});
	return {
		host,
		tick: (later) => {
			clock = later;
			widget.refresh();
		},
	};
}

/** The day numbers of every cell marked as today. */
function todayCells(host: HTMLElement): string[] {
	return Array.from(host.querySelectorAll(".calendaric-day.is-today")).map(
		(cell) => cell.firstChild?.textContent ?? "",
	);
}

/** What the header reads, e.g. "Sep2026". */
function header(host: HTMLElement): string {
	return host.querySelector(".calendaric-month-header")?.textContent ?? "";
}

function press(host: HTMLElement, label: "Previous month" | "Next month"): void {
	host.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click();
}

describe("AC-CAL-11.1: the today mark advances at midnight", () => {
	it("AC-CAL-11.1: a tick after midnight marks the new day as today", () => {
		const { host, tick } = openAt("2026-09-14T23:59:30");
		expect(todayCells(host)).toEqual(["14"]);

		tick("2026-09-15T00:00:30");

		expect(todayCells(host)).toEqual(["15"]);
		expect(header(host)).toBe("Sep2026");
	});
});

describe("AC-CAL-11.2: the displayed month advances with a month rollover", () => {
	it("AC-CAL-11.2: a tick after midnight into a new month shows the new month", () => {
		const { host, tick } = openAt("2026-09-30T23:59:30");

		tick("2026-10-01T00:00:30");

		expect(header(host)).toBe("Oct2026");
		// October 1st, not the adjacent-month copy of it in September's last row.
		const cell = host.querySelector(".calendaric-day.is-today");
		expect(cell?.classList.contains("is-adjacent-month")).toBe(false);
		expect(todayCells(host)).toEqual(["1"]);
	});

	it("AC-CAL-11.2: a user who stepped away and back to today's month still advances", () => {
		const { host, tick } = openAt("2026-09-30T23:59:30");
		press(host, "Next month");
		press(host, "Previous month");
		expect(header(host)).toBe("Sep2026");

		tick("2026-10-01T00:00:30");

		expect(header(host)).toBe("Oct2026");
	});

	it("AC-CAL-11.2: a month the user stepped ahead to follows the clock once it becomes today's", () => {
		const { host, tick } = openAt("2026-09-30T23:59:30");
		press(host, "Next month");

		tick("2026-10-01T00:00:30");
		expect(header(host)).toBe("Oct2026");

		tick("2026-11-01T00:00:30");
		expect(header(host)).toBe("Nov2026");
	});

	it("AC-CAL-11.2: crosses the year out of December", () => {
		const { host, tick } = openAt("2026-12-31T23:59:30");

		tick("2027-01-01T00:00:30");

		expect(header(host)).toBe("Jan2027");
	});
});

describe("AC-CAL-11.3: a month the user navigated to stays put", () => {
	it("AC-CAL-11.3: a tick into a new month leaves an earlier month on screen", () => {
		const { host, tick } = openAt("2026-09-30T23:59:30");
		press(host, "Previous month");

		tick("2026-10-01T00:00:30");

		expect(header(host)).toBe("Aug2026");
		expect(todayCells(host)).toEqual([]);
	});

	it("AC-CAL-11.3: a tick into a new month leaves a later month on screen", () => {
		const { host, tick } = openAt("2026-09-30T23:59:30");
		press(host, "Next month");
		press(host, "Next month");

		tick("2026-10-01T00:00:30");

		expect(header(host)).toBe("Nov2026");
	});

	it("AC-CAL-11.3: a plain day rollover leaves the navigated month on screen", () => {
		const { host, tick } = openAt("2026-09-14T23:59:30");
		press(host, "Previous month");

		tick("2026-09-15T00:00:30");

		expect(header(host)).toBe("Aug2026");
	});
});
