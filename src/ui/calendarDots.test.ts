import { describe, it, expect } from "vitest";
import moment from "moment";
import { DEFAULT_WORDS_PER_SEGMENT, DotScanner, countWords, wordCountSegments } from "./calendarDots";
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

describe("wordCountSegments", () => {
	it("AC-CAL-07.3: at a threshold of 250, fills one segment per 250 words, at least one, at most five", () => {
		const cases: [number, number][] = [
			[1, 1], [249, 1], [250, 1], [499, 1], [500, 2], [1250, 5], [5000, 5],
		];
		for (const [words, segments] of cases) {
			expect(wordCountSegments(words, 250), `${words} words`).toBe(segments);
		}
	});

	it("AC-CAL-07.3: a threshold that is not a positive whole number falls back to 250", () => {
		for (const bad of [0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(wordCountSegments(499, bad), `threshold ${bad}`).toBe(1);
			expect(wordCountSegments(500, bad), `threshold ${bad}`).toBe(2);
		}
		expect(DEFAULT_WORDS_PER_SEGMENT).toBe(250);
	});

	it("AC-CAL-07.3: honours a valid threshold other than the default", () => {
		expect(wordCountSegments(100, 50)).toBe(2);
	});

	it("fills nothing for a note with no words", () => {
		expect(wordCountSegments(0, 250)).toBe(0);
	});
});

describe("countWords", () => {
	it("counts letter and digit runs, across scripts, and ignores punctuation", () => {
		expect(countWords("")).toBe(0);
		expect(countWords("  \n# \n- [ ]  ")).toBe(0);
		expect(countWords("Hello, world! It's 2026.")).toBe(4);
		expect(countWords("zażółć gęślą jaźń")).toBe(3);
	});

	it("leaves out the frontmatter block, which the user did not write as content", () => {
		expect(countWords("---\ntags: [daily, journal]\n---\n")).toBe(0);
		expect(countWords("---\ntags: daily\n---\nOne two")).toBe(2);
	});
});
