// @vitest-environment happy-dom
//
// The calendar and note creation read a granularity's settings through the one
// resolver, so they agree on the note's path (AC-SET-03.3). Each note here is
// written through openOrCreatePeriodNote with the resolved config, as
// main.ts:330 calls it, then looked for by the calendar: a stored format of ""
// is where a raw read and the resolved default part ways.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

async function createNote(
	deps: ReturnType<typeof fakeDeps>,
	granularity: ReleaseGranularity,
	date: ReturnType<typeof window.moment>,
	settings = SETTINGS,
): Promise<string> {
	const before = new Set(deps.vault.listNotes().map((note) => note.path));
	await openOrCreatePeriodNote(granularity, date, resolveEffectiveConfig(settings, granularity), null, deps);
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

	// A stored "" would number weeks the same as the week default, so a raw read
	// of the week format only shows with a value the resolver must replace, here
	// 5. Settings load already repairs such a value: this guards the wiring.
	it("AC-SET-03.3: numbers week rows from the resolved week format, not the stored one", () => {
		const settings = { ...SETTINGS, week: { ...SETTINGS.week, format: 5 } } as unknown as CalendaricSettings;

		const host = render(fakeDeps(), settings);

		const expected = getWeekNumber(secondRowAnchor(), resolveEffectiveConfig(settings, "week").format);
		expect(weekCell(host, 1).firstChild?.textContent).toBe(String(expected));
	});
});

function handEdited(granularity: "day" | "week", fields: Record<string, unknown>): CalendaricSettings {
	return { ...SETTINGS, [granularity]: { ...SETTINGS[granularity], ...fields } } as unknown as CalendaricSettings;
}

/** A workspace whose active file the test sets; `open` also fires `file-open`. */
function activeFileApp(): { app: App; open: (path: string) => void } {
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
			active = { path };
			for (const cb of handlers) cb(active);
		},
	};
}

const activeDays = (host: HTMLElement): string[] =>
	Array.from(host.querySelectorAll(".calendaric-day.is-active")).map((cell) => cell.firstChild?.textContent ?? "");

describe("the active note, and every field the resolver repairs", () => {
	const realMoment = window.moment;

	// A fixed month, so the reveal test's week row straddles a month end.
	beforeEach(() => {
		window.moment = Object.assign(
			(...args: Parameters<typeof realMoment>) =>
				args.length === 0 ? realMoment("2026-05-15T12:00:00") : realMoment(...args),
			realMoment,
		);
	});

	afterEach(() => {
		window.moment = realMoment;
	});

	it("AC-SET-03.3: a day note written with the default for an empty format is highlighted as the active note", async () => {
		const deps = fakeDeps();
		const path = await createNote(deps, "day", tenthOfMonth());
		const { app, open } = activeFileApp();
		const host = document.createElement("div");
		new CalendarWidget(host, app, SETTINGS, deps);

		open(path);

		expect(activeDays(host)).toEqual(["10"]);
	});

	// A stored "" finds the same week row as the default here, because the
	// note's parsed date is already its row's first day; only a value the
	// resolver must replace tells a raw read of the week format apart.
	it("AC-SET-03.3: revealing an active week note reads the resolved week format", async () => {
		const settings = handEdited("week", { format: 5 });
		const deps = fakeDeps();
		const grid = getMonthGrid(firstOfMonth(), resolveWeekStart(SETTINGS.weekStart), "");
		const lastRow = grid.find((week) => week.days.some((day) => day.date.isSame(firstOfMonth().endOf("month"), "day")))!;
		const path = await createNote(deps, "week", getWeekAnchor(lastRow.days), settings);
		const { app, open } = activeFileApp();
		const host = document.createElement("div");
		const widget = new CalendarWidget(host, app, settings, deps);

		open(path);
		widget.revealActiveNote();

		expect(host.querySelector(".calendaric-month")?.textContent).toBe(firstOfMonth().format("MMM"));
	});

	it("AC-SET-03.3: a hand-edited prefix-match flag the resolver turns off does not count a prefixed name as the active note", async () => {
		const settings = handEdited("day", { format: "YYYY-MM-DD", allowPrefixMatch: "yes" });
		const deps = fakeDeps();
		const path = await createNote(deps, "day", tenthOfMonth(), settings);
		const { app, open } = activeFileApp();
		const host = document.createElement("div");
		new CalendarWidget(host, app, settings, deps);

		open(path);
		expect(activeDays(host)).toEqual(["10"]);
		open(path.replace(/\.md$/, " standup.md"));
		expect(activeDays(host)).toEqual([]);
	});

	it("AC-SET-03.3: a hand-edited folder the resolver drops finds the note where note creation put it", async () => {
		const settings = handEdited("day", { folder: 5 });
		const deps = fakeDeps();
		await createNote(deps, "day", tenthOfMonth(), settings);

		expect(hasDot(dayCell(render(deps, settings), 10))).toBe(true);
	});

	it("AC-SET-03.3: a hand-edited template path the resolver drops writes the note note creation writes", async () => {
		const settings = handEdited("day", { templatePath: 5 });
		const byCreation = fakeDeps();
		const path = await createNote(byCreation, "day", tenthOfMonth(), settings);
		const byCalendar = fakeDeps();
		const host = render(byCalendar, settings);

		dayCell(host, 10).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle();

		expect(byCalendar.vault.listNotes().map((note) => note.path)).toEqual([path]);
		expect(byCalendar.vault.contentAt(path)).toBe(byCreation.vault.contentAt(path));
		expect(byCalendar.workspace.notices).toEqual(byCreation.workspace.notices);
	});
});
