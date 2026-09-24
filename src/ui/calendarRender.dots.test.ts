// @vitest-environment happy-dom
//
// The two built-in indicator dots — note exists, word count — as the grid
// draws them, over fake ports. The word count arrives after an async read, so
// every test waits for the pane to settle before it looks.
/* eslint-disable import/no-nodejs-modules -- That rule guards the BUNDLE. This
   file is a test, esbuild never sees it, and AC-CAL-07.4 reads styles.css to
   check the two dots do not share a colour. */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { CalendarWidget } from "./calendar";
import { getMonthGrid, getWeekAnchor } from "./calendarUtils";
import { computeNotePath } from "../notes/noteUtils";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { DEFAULT_SETTINGS } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";

const SETTINGS: CalendaricSettings = {
	...DEFAULT_SETTINGS,
	showWeekNumbers: true,
	weekStart: "monday",
	day: { ...DEFAULT_SETTINGS.day, enabled: true, format: "YYYY-MM-DD" },
	week: { ...DEFAULT_SETTINGS.week, enabled: true, format: "gggg-[W]ww" },
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

function words(n: number): string {
	return Array.from({ length: n }, () => "word").join(" ");
}

const firstOfMonth = () => window.moment().startOf("month");

function dayPath(dayOfMonth: number): string {
	return computeNotePath(firstOfMonth().add(dayOfMonth - 1, "day"), SETTINGS.day, new FakeVaultConfigPort());
}

/** The path of the week note the second grid row stands for. */
function secondRowWeekPath(): string {
	const grid = getMonthGrid(firstOfMonth(), 1, SETTINGS.week.format);
	return computeNotePath(getWeekAnchor(grid[1]!.days), SETTINGS.week, new FakeVaultConfigPort());
}

async function render(notes: Record<string, string>): Promise<HTMLElement> {
	const vault = new FakeVaultPort();
	for (const [path, content] of Object.entries(notes)) vault.seedFile(path, content);
	const host = document.createElement("div");
	new CalendarWidget(host, eventOnlyApp(), SETTINGS, {
		vault,
		vaultConfig: new FakeVaultConfigPort(),
		workspace: new FakeWorkspacePort(),
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	return host;
}

/** The day cell for a day of the displayed month, not an adjacent month's. */
function dayCell(host: HTMLElement, dayOfMonth: number): HTMLElement {
	const cell = Array.from(host.querySelectorAll<HTMLElement>(".calendaric-day:not(.is-adjacent-month)"))
		.find((el) => el.firstChild?.textContent === String(dayOfMonth));
	if (!cell) throw new Error(`no cell for day ${dayOfMonth}`);
	return cell;
}

function weekCell(host: HTMLElement, row: number): HTMLElement {
	return host.querySelectorAll<HTMLElement>(".calendaric-weeknum")[row]!;
}

const existsDots = (cell: HTMLElement) => cell.querySelectorAll(".calendaric-dot--exists").length;
const wordDots = (cell: HTMLElement) => cell.querySelectorAll(".calendaric-dot--words").length;
const filled = (cell: HTMLElement) => cell.querySelectorAll(".calendaric-dot--words .is-filled").length;

describe("CalendarWidget indicator dots", () => {
	it("AC-CAL-07.1: a day or week with no note shows no dot of either kind", async () => {
		const host = await render({});

		expect(existsDots(dayCell(host, 3)) + wordDots(dayCell(host, 3))).toBe(0);
		expect(existsDots(weekCell(host, 1)) + wordDots(weekCell(host, 1))).toBe(0);
		expect(host.querySelectorAll(".calendaric-dot").length).toBe(0);
	});

	it("AC-CAL-07.2: a note with words shows a word-count dot with a segment filled, on day and week cells", async () => {
		const host = await render({ [dayPath(3)]: "one", [secondRowWeekPath()]: words(10) });

		expect(wordDots(dayCell(host, 3))).toBe(1);
		expect(filled(dayCell(host, 3))).toBeGreaterThanOrEqual(1);
		expect(wordDots(weekCell(host, 1))).toBe(1);
		expect(filled(weekCell(host, 1))).toBeGreaterThanOrEqual(1);
	});

	it("AC-CAL-07.3: at the default threshold of 250 the cell fills 1, 2 and 5 of five segments", async () => {
		const host = await render({
			[dayPath(3)]: words(499),
			[dayPath(4)]: words(500),
			[dayPath(5)]: words(1300),
		});

		expect(filled(dayCell(host, 3))).toBe(1);
		expect(filled(dayCell(host, 4))).toBe(2);
		expect(filled(dayCell(host, 5))).toBe(5);
		expect(dayCell(host, 5).querySelectorAll(".calendaric-dot--words .calendaric-dot-segment").length).toBe(5);
	});

	it("AC-CAL-07.4: a note with words shows both dots, told apart by class and colour", async () => {
		const host = await render({ [dayPath(3)]: words(300) });
		const cell = dayCell(host, 3);

		expect(existsDots(cell)).toBe(1);
		expect(wordDots(cell)).toBe(1);

		// The colour lives in styles.css; the two classes must not share a fill.
		const css = readFileSync("styles.css", "utf8");
		const fillOf = (selector: string) =>
			new RegExp(`\\${selector}[^{]*\\{[^}]*fill:\\s*([^;]+);`).exec(css)?.[1]?.trim();
		expect(fillOf(".calendaric-dot--words")).toBeDefined();
		expect(fillOf(".calendaric-dot--words")).not.toBe(fillOf(".calendaric-dot"));
	});

	it("AC-CAL-07.5: an empty note keeps its note-exists dot and shows no word-count dot", async () => {
		const host = await render({ [dayPath(3)]: "---\ntags: daily\n---\n", [secondRowWeekPath()]: "" });

		expect(existsDots(dayCell(host, 3))).toBe(1);
		expect(wordDots(dayCell(host, 3))).toBe(0);
		expect(existsDots(weekCell(host, 1))).toBe(1);
		expect(wordDots(weekCell(host, 1))).toBe(0);
	});
});
