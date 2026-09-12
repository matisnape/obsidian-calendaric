import { describe, it, expect } from "vitest";
import moment from "moment";
import { DotScanner } from "./calendarDots";
import { getMonthGrid, getWeekAnchor } from "./calendarUtils";
import { computeNotePath } from "../notes/noteUtils";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import type { CalendarDeps } from "../adapters/calendarDeps";
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

// Fakes only: the scanner asks its ports, so a running Obsidian — and a
// stand-in for one — is not needed (AC-ARCH-11.1).
function makeDeps(existingPaths: string[]): CalendarDeps {
	const vault = new FakeVaultPort();
	for (const path of existingPaths) vault.seedFile(path, "");
	return { vault, vaultConfig: new FakeVaultConfigPort(), workspace: new FakeWorkspacePort() };
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
		const scanner = new DotScanner(makeDeps(rowPaths), () => undefined);

		expect([...scanner.getWeekNotePaths(grid, weekConfig)].sort()).toEqual(
			[...new Set(rowPaths)].sort(),
		);
	});

	it("finds the note of a Sunday-start row under the row's own week", () => {
		// An isoWeekday(1) anchor would look for the week before this row and
		// miss the note the week cell shows a number for.
		const grid = getMonthGrid(moment("2026-03-15"), 0, WEEK_FORMAT);
		const own = pathFor("2026-03-01");
		const scanner = new DotScanner(makeDeps([own]), () => undefined);

		expect(scanner.getWeekNotePaths(grid, weekConfig).has(own)).toBe(true);
	});

	it("returns nothing when weekly notes are disabled or unformatted", () => {
		const grid = getMonthGrid(moment("2026-12-15"), 1, WEEK_FORMAT);
		const scanner = new DotScanner(makeDeps([pathFor("2026-12-28")]), () => undefined);

		expect(scanner.getWeekNotePaths(grid, { ...weekConfig, enabled: false }).size).toBe(0);
		expect(scanner.getWeekNotePaths(grid, { ...weekConfig, format: "" }).size).toBe(0);
	});
});
