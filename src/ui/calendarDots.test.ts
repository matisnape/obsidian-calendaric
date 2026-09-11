import { describe, it, expect } from "vitest";
import moment from "moment";
import type { App } from "obsidian";
import { DotScanner } from "./calendarDots";
import { getMonthGrid, getWeekAnchor } from "./calendarUtils";
import { computeNotePath } from "../notes/noteUtils";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import type { PeriodicConfig } from "../types";

const WEEK_FORMAT = "gggg-[W]ww";

const weekConfig: PeriodicConfig = {
	enabled: true,
	format: WEEK_FORMAT,
	folder: "Weekly",
	templatePath: "",
	allowPrefixMatch: false,
	openAtStartup: false,
};

// Structural App fixture — DotScanner only reaches for vault.on and
// vault.getAbstractFileByPath, so a running Obsidian is not needed.
function makeApp(existingPaths: string[]): App {
	const present = new Set(existingPaths);
	return {
		vault: {
			on: () => ({}),
			offref: () => undefined,
			getAbstractFileByPath: (path: string) => (present.has(path) ? {} : null),
		},
	} as unknown as App;
}

function pathFor(date: string): string {
	return computeNotePath(moment(date), weekConfig, new FakeVaultConfigPort());
}

describe("DotScanner.getWeekNotePaths", () => {
	it("scans exactly the rows the grid draws, one anchor per row", () => {
		const grid = getMonthGrid(moment("2026-12-15"), 1, WEEK_FORMAT);
		const rowPaths = grid.map((week) =>
			computeNotePath(getWeekAnchor(week.days), weekConfig, new FakeVaultConfigPort()),
		);
		const scanner = new DotScanner(makeApp(rowPaths), () => undefined);

		expect([...scanner.getWeekNotePaths(grid, weekConfig)].sort()).toEqual(
			[...new Set(rowPaths)].sort(),
		);
	});

	it("finds the note of a Sunday-start row under the row's own week", () => {
		// An isoWeekday(1) anchor would look for the week before this row and
		// miss the note the week cell shows a number for.
		const grid = getMonthGrid(moment("2026-03-15"), 0, WEEK_FORMAT);
		const own = pathFor("2026-03-01");
		const scanner = new DotScanner(makeApp([own]), () => undefined);

		expect(scanner.getWeekNotePaths(grid, weekConfig).has(own)).toBe(true);
	});

	it("returns nothing when weekly notes are disabled or unformatted", () => {
		const grid = getMonthGrid(moment("2026-12-15"), 1, WEEK_FORMAT);
		const scanner = new DotScanner(makeApp([pathFor("2026-12-28")]), () => undefined);

		expect(scanner.getWeekNotePaths(grid, { ...weekConfig, enabled: false }).size).toBe(0);
		expect(scanner.getWeekNotePaths(grid, { ...weekConfig, format: "" }).size).toBe(0);
	});
});
