// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "moment/locale/pl";
import type { App } from "obsidian";
import { CalendarWidget } from "./calendar";
import { applyLocale, restoreLocale } from "../fmt/locale";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { DEFAULT_SETTINGS } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";

const SETTINGS: CalendaricSettings = {
	...DEFAULT_SETTINGS,
	showWeekNumbers: true,
	weekStart: "monday",
	overrideLocale: "en",
	week: { ...DEFAULT_SETTINGS.week, format: "gggg-[W]ww" },
};

function eventOnlyApp(): App {
	return {
		workspace: {
			on: (): object => ({}),
			offref: (): undefined => undefined,
			trigger: (): undefined => undefined,
		},
	} as unknown as App;
}

/** What the settings tab's save does: apply the new settings, then refresh the open calendar. */
function change(widget: CalendarWidget, settings: CalendaricSettings): void {
	applyLocale(settings.overrideLocale, settings.weekStart, "en");
	widget.refreshSettings(settings);
}

function build(settings: CalendaricSettings): { host: HTMLElement; widget: CalendarWidget } {
	applyLocale(settings.overrideLocale, settings.weekStart, "en");
	const host = document.createElement("div");
	const widget = new CalendarWidget(host, eventOnlyApp(), settings, {
		vault: new FakeVaultPort(),
		vaultConfig: new FakeVaultConfigPort(),
		workspace: new FakeWorkspacePort(),
	});
	return { host, widget };
}

const headers = (host: HTMLElement): string[] =>
	Array.from(host.querySelectorAll("thead th:not(.calendaric-weeknum-header)"), (th) => th.textContent ?? "");
const firstDay = (host: HTMLElement): string =>
	host.querySelector("tbody tr td:not(.calendaric-weeknum-cell)")?.textContent ?? "";
const firstWeekNumber = (host: HTMLElement): string =>
	host.querySelector(".calendaric-weeknum")?.firstChild?.textContent ?? "";
const month = (host: HTMLElement): string => host.querySelector(".calendaric-month")?.textContent ?? "";

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 3, 15, 12));
	window.moment.locale("en");
});

afterEach(() => {
	restoreLocale();
	vi.useRealTimers();
});

describe("CalendarWidget: locale and week start", () => {
	it("AC-FMT-03.1: a Polish locale gives Polish weekday and month names in the grid", () => {
		const { host } = build({ ...SETTINGS, overrideLocale: "pl" });
		expect(headers(host)).toEqual(["pon", "wt", "śr", "czw", "pt", "sob", "ndz"]);
		expect(month(host)).toBe("kwi");
	});

	it("AC-FMT-03.2: the grid's first column, its headers and its week numbers share one week start", () => {
		const { host } = build({ ...SETTINGS, weekStart: "sunday" });
		expect(headers(host)[0]).toBe("Sun");
		// April 2026 opens on Sun 29 March under a Sunday start; en counts that week as 14.
		expect(firstDay(host)).toContain("29");
		expect(firstWeekNumber(host)).toBe("14");
	});

	it("AC-FMT-03.3: changing locale and week start re-renders an open calendar with no reload", () => {
		const { host, widget } = build(SETTINGS);
		expect(headers(host)[0]).toBe("Mon");
		expect(month(host)).toBe("Apr");
		expect(firstDay(host)).toContain("30");
		expect(firstWeekNumber(host)).toBe("14");

		change(widget, { ...SETTINGS, overrideLocale: "pl", weekStart: "sunday" });

		expect(headers(host)[0]).toBe("ndz");
		expect(month(host)).toBe("kwi");
		expect(firstDay(host)).toContain("29");
		// Poland's week 1 holds 4 January; a Sunday start opens it on Sun 4 January, so 29 March is week 13.
		expect(firstWeekNumber(host)).toBe("13");
	});
});
