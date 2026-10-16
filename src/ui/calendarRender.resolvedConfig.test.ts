// @vitest-environment happy-dom
//
// The calendar and note creation read a granularity's settings through the one
// resolver, so they agree on the note's path (AC-SET-03.3). Each note here is
// written by the note-creation path main.ts runs, then looked for by the
// calendar: a stored format of "" is where a raw read and the resolved default
// part ways.
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { CalendarWidget } from "./calendar";
import { getMonthGrid, getWeekAnchor, resolveWeekStart } from "./calendarUtils";
import { getWeekNumber } from "../notes/noteUtils";
import { openOrCreatePeriodNote } from "../notes/periodNoteOpen";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import type { CalendarDeps } from "../adapters/calendarDeps";
import { DEFAULT_SETTINGS, resolveEffectiveConfig } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";
import type { ReleaseGranularity } from "../types";

const EMPTY_FORMAT = { enabled: true, format: "", folder: "Journal" };

const SETTINGS: CalendaricSettings = {
	...DEFAULT_SETTINGS,
	showWeekNumbers: true,
	confirmBeforeCreate: false,
	day: { ...DEFAULT_SETTINGS.day, ...EMPTY_FORMAT },
	week: { ...DEFAULT_SETTINGS.week, ...EMPTY_FORMAT },
	month: { ...DEFAULT_SETTINGS.month, ...EMPTY_FORMAT },
};

/** Records `file-menu` triggers, the one App call the month header's context menu makes. */
function recordingApp(triggered: unknown[][]): App {
	return {
		workspace: {
			on: (): object => ({}),
			offref: (): undefined => undefined,
			trigger: (...args: unknown[]): void => {
				triggered.push(args);
			},
		},
	} as unknown as App;
}

function fakeDeps(): CalendarDeps & { vault: FakeVaultPort; workspace: FakeWorkspacePort } {
	return { vault: new FakeVaultPort(), vaultConfig: new FakeVaultConfigPort(), workspace: new FakeWorkspacePort() };
}

/** Writes the note the way main.ts's open-current command does, and returns the path it landed at. */
async function createNote(deps: ReturnType<typeof fakeDeps>, granularity: ReleaseGranularity, date: ReturnType<typeof window.moment>): Promise<string> {
	const before = new Set(deps.vault.listNotes().map((note) => note.path));
	await openOrCreatePeriodNote(granularity, date, resolveEffectiveConfig(SETTINGS, granularity), null, deps);
	const written = deps.vault.listNotes().map((note) => note.path).filter((path) => !before.has(path));
	expect(written).toHaveLength(1);
	// Creation opens the note too; only what the calendar opens afterwards is under test.
	deps.workspace.opened.length = 0;
	return written[0]!;
}

const firstOfMonth = () => window.moment().startOf("month");
const tenthOfMonth = () => firstOfMonth().add(9, "day");
const secondRowAnchor = () =>
	getWeekAnchor(getMonthGrid(firstOfMonth(), resolveWeekStart(SETTINGS.weekStart), "")[1]!.days);

function render(deps: CalendarDeps, settings = SETTINGS, triggered: unknown[][] = []): HTMLElement {
	const host = document.createElement("div");
	new CalendarWidget(host, recordingApp(triggered), settings, deps);
	return host;
}

function dayCell(host: HTMLElement, dayOfMonth: number): HTMLElement {
	const cell = Array.from(host.querySelectorAll<HTMLElement>(".calendaric-day:not(.is-adjacent-month)"))
		.find((el) => el.firstChild?.textContent === String(dayOfMonth));
	if (!cell) throw new Error(`no cell for day ${dayOfMonth}`);
	return cell;
}

const weekCell = (host: HTMLElement, row: number): HTMLElement => host.querySelectorAll<HTMLElement>(".calendaric-weeknum")[row]!;
const hasDot = (cell: HTMLElement): boolean => cell.querySelector(".calendaric-dot--exists") !== null;
const settle = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));

describe("calendar reads the resolved config", () => {
	it("AC-SET-03.3: a day note written with the default for an empty format earns its dot", async () => {
		const deps = fakeDeps();
		await createNote(deps, "day", tenthOfMonth());

		expect(hasDot(dayCell(render(deps), 10))).toBe(true);
	});

	it("AC-SET-03.3: a week note written with the default for an empty format earns its row's dot", async () => {
		const deps = fakeDeps();
		await createNote(deps, "week", secondRowAnchor());

		expect(hasDot(weekCell(render(deps), 1))).toBe(true);
	});

	it("AC-SET-03.3: clicking a day opens the note note creation wrote, and writes no second one", async () => {
		const deps = fakeDeps();
		const path = await createNote(deps, "day", tenthOfMonth());
		const host = render(deps);

		dayCell(host, 10).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle();

		expect(deps.workspace.opened.map((open) => open.file.path)).toEqual([path]);
		expect(deps.vault.listNotes().map((note) => note.path)).toEqual([path]);
	});

	it("AC-SET-03.3: clicking a week row opens the note note creation wrote, and writes no second one", async () => {
		const deps = fakeDeps();
		const path = await createNote(deps, "week", secondRowAnchor());
		const host = render(deps);

		weekCell(host, 1).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle();

		expect(deps.workspace.opened.map((open) => open.file.path)).toEqual([path]);
		expect(deps.vault.listNotes().map((note) => note.path)).toEqual([path]);
	});

	it("AC-SET-03.3: the month header's context menu finds the month note note creation wrote", async () => {
		const deps = fakeDeps();
		const path = await createNote(deps, "month", firstOfMonth());
		const triggered: unknown[][] = [];
		const host = render(deps, SETTINGS, triggered);

		host.querySelector(".calendaric-month-header")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

		const fileMenus = triggered.filter((args) => args[0] === "file-menu");
		expect(fileMenus.map((args) => (args[2] as { path: string }).path)).toEqual([path]);
	});

	// Settings load already repairs a wrong-typed value, so this guards the
	// calendar's wiring: "" numbers weeks the same as the week default, and only
	// a value the resolver must replace tells a raw read of the week format apart.
	it("AC-SET-03.3: numbers week rows from the resolved week format, not the stored one", () => {
		const settings = { ...SETTINGS, week: { ...SETTINGS.week, format: 5 } } as unknown as CalendaricSettings;

		const host = render(fakeDeps(), settings);

		const expected = getWeekNumber(secondRowAnchor(), resolveEffectiveConfig(settings, "week").format);
		expect(weekCell(host, 1).firstChild?.textContent).toBe(String(expected));
	});
});
