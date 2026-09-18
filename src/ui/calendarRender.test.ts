// @vitest-environment happy-dom
//
// The only DOM-environment test file in the suite. Every other test runs in
// node, which is faster; opt in here per-file rather than flipping the default
// so the 557 node tests keep their speed.
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { CalendarWidget } from "./calendar";
import { ObsidianVaultAdapter } from "../adapters/obsidianVaultAdapter";
import { ObsidianVaultConfigAdapter } from "../adapters/obsidianVaultConfigAdapter";
import { ObsidianWorkspaceAdapter } from "../adapters/obsidianWorkspaceAdapter";
import { DEFAULT_SETTINGS } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";

/**
 * The host, as much of it as the header behaviour actually reaches.
 *
 * The widget takes its ports now, and this file hands it the REAL adapters over
 * this fake `App` on purpose: a header click then runs the whole route —
 * compute the path, look the note up, create it, open it — including the
 * adapter layer the fakes-only test in calendarFakes.test.ts leaves out.
 * Everything those adapters touch is here, and the three lists are what the
 * tests read back.
 *
 * The files are real `TFile` instances because `ObsidianWorkspaceAdapter`
 * compares the note it is handed against the object at the path by identity,
 * and refuses anything that is not a `TFile`. A plain `{ path }` stand-in would
 * report every open as "missing" and quietly pass a test that opened nothing.
 */
class FakeApp {
	readonly files = new Map<string, TFile>();
	/** Paths written through `vault.create`, in order. */
	readonly created: string[] = [];
	/** Every note opened, with the leaf argument that decided where it landed. */
	readonly opened: { path: string; leaf: unknown }[] = [];
	/** Every `workspace.trigger` call, arguments and all. */
	readonly triggered: unknown[][] = [];

	readonly workspace = {
		on: (): object => ({}),
		offref: (): undefined => undefined,
		trigger: (...args: unknown[]): void => {
			this.triggered.push(args);
		},
		getLeaf: (leaf: unknown) => ({
			openFile: async (file: TFile): Promise<void> => {
				this.opened.push({ path: file.path, leaf });
			},
		}),
	};

	// ObsidianVaultAdapter.onChange subscribes to the metadata cache as well as
	// to the vault, because a frontmatter date lands after the create event.
	readonly metadataCache = {
		on: (): object => ({}),
		offref: (): undefined => undefined,
		getFileCache: (): null => null,
	};

	readonly vault = {
		on: (): object => ({}),
		offref: (): undefined => undefined,
		// An empty vault config sends every unconfigured folder to the root.
		config: {},
		getAbstractFileByPath: (path: string): TFile | null => this.files.get(path) ?? null,
		create: async (path: string, _content: string): Promise<TFile> => {
			this.created.push(path);
			return this.seed(path);
		},
	};

	/** Puts a note at `path` and hands back the object the vault will answer with. */
	seed(path: string): TFile {
		const file = new TFile();
		file.path = path;
		this.files.set(path, file);
		return file;
	}

	asApp(): App {
		return this as unknown as App;
	}
}

function render(settings: CalendaricSettings, app: FakeApp = new FakeApp()): HTMLElement {
	const host = document.createElement("div");
	const obsidianApp = app.asApp();
	new CalendarWidget(host, obsidianApp, settings, {
		vault: new ObsidianVaultAdapter(obsidianApp),
		vaultConfig: new ObsidianVaultConfigAdapter(obsidianApp),
		workspace: new ObsidianWorkspaceAdapter(obsidianApp),
	});
	return host;
}

function cellsPerRow(host: HTMLElement): number[] {
	return Array.from(host.querySelectorAll("tbody tr")).map(
		(row) => row.querySelectorAll("td").length,
	);
}

describe("CalendarWidget: the week-number column", () => {
	it("AC-CAL-01.5: renders no week-number header or cells when showWeekNumbers is off", () => {
		const shown = render({ ...DEFAULT_SETTINGS, showWeekNumbers: true });
		expect(shown.querySelectorAll(".calendaric-weeknum-header")).toHaveLength(1);
		expect(shown.querySelectorAll(".calendaric-weeknum-cell")).toHaveLength(6);
		expect(cellsPerRow(shown)).toEqual([8, 8, 8, 8, 8, 8]);

		const hidden = render({ ...DEFAULT_SETTINGS, showWeekNumbers: false });
		expect(hidden.querySelectorAll(".calendaric-weeknum-header")).toHaveLength(0);
		expect(hidden.querySelectorAll(".calendaric-weeknum-cell")).toHaveLength(0);
		// The column is gone, not merely emptied: seven day cells, no eighth.
		expect(cellsPerRow(hidden)).toEqual([7, 7, 7, 7, 7, 7]);
	});
});

/** Monthly notes configured, in the vault root, and created without a prompt. */
const MONTHLY: CalendaricSettings = {
	...DEFAULT_SETTINGS,
	confirmBeforeCreate: false,
	month: { ...DEFAULT_SETTINGS.month, enabled: true, format: "YYYY-MM" },
};

const MONTH_FORMAT = "YYYY-MM";

/** The note path for the month `offset` steps back from the current one. */
function monthPath(offset = 0): string {
	return `${window.moment().subtract(offset, "month").format(MONTH_FORMAT)}.md`;
}

/** What the header reads right now, e.g. "Apr2026". */
function headerText(host: HTMLElement): string {
	return monthHeader(host).textContent ?? "";
}

function monthHeader(host: HTMLElement): HTMLElement {
	const el = host.querySelector<HTMLElement>(".calendaric-month-header");
	if (!el) throw new Error("the month header has no dedicated click target");
	return el;
}

/** One step back, through the control the user would use. */
function goToPreviousMonth(host: HTMLElement): void {
	const prev = host.querySelector<HTMLElement>('[aria-label="Previous month"]');
	if (!prev) throw new Error("no previous-month control");
	prev.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function clickHeader(host: HTMLElement, init: MouseEventInit = {}): MouseEvent {
	const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
	monthHeader(host).dispatchEvent(event);
	return event;
}

function rightClickHeader(host: HTMLElement): MouseEvent {
	const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
	monthHeader(host).dispatchEvent(event);
	return event;
}

/**
 * Lets the click's own promise chain finish.
 *
 * The DOM handler cannot be awaited — a listener returns void — so the open
 * lands a few microtasks after `dispatchEvent` returns. A macrotask is past all
 * of them.
 */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("CalendarWidget: the month header", () => {
	it("AC-CAL-05.1: opens the displayed month's note in the active pane, leaving the grid where it was", async () => {
		const app = new FakeApp();
		app.seed(monthPath(1));
		const host = render(MONTHLY, app);
		goToPreviousMonth(host);
		const displayed = headerText(host);

		clickHeader(host);
		await settle();

		// `false` is Obsidian's "reuse the active unpinned tab".
		expect(app.opened).toEqual([{ path: monthPath(1), leaf: false }]);
		expect(app.created).toEqual([]);
		// The click opened a note and moved nothing: a header that reset the
		// month here would be showing the current month instead.
		expect(headerText(host)).toBe(displayed);
	});

	it("AC-CAL-05.1: creates the displayed month's note first when it is missing, then opens it", async () => {
		const app = new FakeApp();
		const host = render(MONTHLY, app);

		clickHeader(host);
		await settle();

		expect(app.created).toEqual([monthPath()]);
		expect(app.opened).toEqual([{ path: monthPath(), leaf: false }]);
	});

	it("AC-CAL-05.2: opens the month's note in a split when the click carries the split modifier", async () => {
		const app = new FakeApp();
		app.seed(monthPath());
		const host = render(MONTHLY, app);

		// The mock host is not a Mac, so Ctrl is the split modifier there.
		clickHeader(host, { ctrlKey: true });
		await settle();

		expect(app.opened).toEqual([{ path: monthPath(), leaf: "split" }]);
	});

	it("AC-CAL-05.2: creates the missing month note first, then opens it in the split", async () => {
		const app = new FakeApp();
		const host = render(MONTHLY, app);

		clickHeader(host, { ctrlKey: true });
		await settle();

		expect(app.created).toEqual([monthPath()]);
		expect(app.opened).toEqual([{ path: monthPath(), leaf: "split" }]);
	});

	it("AC-CAL-05.3: resets the grid to the current month when monthly notes are not configured", async () => {
		const app = new FakeApp();
		// DEFAULT_SETTINGS leaves month disabled, which is "not configured".
		const host = render(DEFAULT_SETTINGS, app);
		const current = headerText(host);
		goToPreviousMonth(host);
		expect(headerText(host)).not.toBe(current);

		clickHeader(host);
		await settle();

		// The same thing the dedicated 'return to today' control does, and
		// nothing else: no note is looked for, written, or opened.
		expect(headerText(host)).toBe(current);
		expect(app.created).toEqual([]);
		expect(app.opened).toEqual([]);
	});

	it("AC-CAL-05.4: right-clicking a month that has a note opens that file's context menu at the click", () => {
		const app = new FakeApp();
		const file = app.seed(monthPath());
		const host = render(MONTHLY, app);

		const event = rightClickHeader(host);

		const fileMenus = app.triggered.filter((args) => args[0] === "file-menu");
		expect(fileMenus).toHaveLength(1);
		const [, menu, target] = fileMenus[0] ?? [];
		expect(target).toBe(file);
		// The fake Menu records the event it was shown at; the position comes
		// from the event, so handing it the click is the whole of "at the click
		// position".
		expect((menu as { shownAtEvent: MouseEvent | null }).shownAtEvent).toBe(event);
		// Obsidian's own menu must not open on top of this one.
		expect(event.defaultPrevented).toBe(true);
	});

	it("AC-CAL-05.4: right-clicking a month with no note opens no file menu", () => {
		const app = new FakeApp();
		const host = render(MONTHLY, app);

		const event = rightClickHeader(host);

		expect(app.triggered.filter((args) => args[0] === "file-menu")).toEqual([]);
		// Nothing was claimed, so the browser's own menu still belongs here.
		expect(event.defaultPrevented).toBe(false);
	});

	it("AC-CAL-05.5: the header's click target is its own element, not the month/year markup or a nav control", async () => {
		const app = new FakeApp();
		app.seed(monthPath());
		const host = render(MONTHLY, app);

		// One element answers to the class, and it is the header itself rather
		// than anything the nav buttons render.
		const targets = host.querySelectorAll(".calendaric-month-header");
		expect(targets).toHaveLength(1);
		const target = monthHeader(host);
		expect(host.querySelector(".calendaric-nav-buttons")?.contains(target)).toBe(false);

		// Navigating rebuilds the month/year spans inside the header. The target
		// is the element that survives that, so it cannot be one of them.
		const spansBefore = Array.from(target.querySelectorAll("span"));
		goToPreviousMonth(host);
		const spansAfter = Array.from(target.querySelectorAll("span"));
		expect(spansAfter.length).toBeGreaterThan(0);
		expect(spansAfter.some((span) => spansBefore.includes(span))).toBe(false);
		expect(monthHeader(host)).toBe(target);

		// And it is still the thing that opens the note.
		app.seed(monthPath(1));
		clickHeader(host);
		await settle();
		expect(app.opened).toEqual([{ path: monthPath(1), leaf: false }]);
	});
});

const WEEK_FORMAT = "gggg-[W]ww";

/** Weekly notes configured, in the vault root, and created without a prompt. */
const WEEKLY: CalendaricSettings = {
	...DEFAULT_SETTINGS,
	confirmBeforeCreate: false,
	showWeekNumbers: true,
	week: { ...DEFAULT_SETTINGS.week, enabled: true, format: WEEK_FORMAT },
};

/**
 * The note path of the week the grid's `row`-th line stands for, derived from
 * the calendar rather than from the widget: `weekStart` is Monday here, so the
 * grid opens on the Monday on or before the 1st and each later row is seven
 * days on.
 */
function weekPath(row = 0): string {
	const anchor = window.moment().startOf("month").startOf("isoWeek").add(row * 7, "day");
	return `${anchor.format(WEEK_FORMAT)}.md`;
}

function weekCell(host: HTMLElement, row = 0): HTMLElement {
	const cell = host.querySelectorAll<HTMLElement>(".calendaric-weeknum")[row];
	if (!cell) throw new Error(`no week-number cell on row ${row}`);
	return cell;
}

function clickWeekCell(host: HTMLElement, init: MouseEventInit = {}): MouseEvent {
	const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
	weekCell(host).dispatchEvent(event);
	return event;
}

function hoverWeekCell(host: HTMLElement, init: MouseEventInit = {}): MouseEvent {
	const event = new MouseEvent("mouseover", { bubbles: true, cancelable: true, ...init });
	weekCell(host).dispatchEvent(event);
	return event;
}

/** The `hover-link` payloads the widget handed Obsidian, in order. */
function hoverLinks(app: FakeApp): Record<string, unknown>[] {
	return app.triggered
		.filter((args) => args[0] === "hover-link")
		.map((args) => args[1] as Record<string, unknown>);
}

describe("CalendarWidget: the week-number cell", () => {
	it("AC-CAL-04.1: opens the week's existing note in the active pane", async () => {
		const app = new FakeApp();
		app.seed(weekPath());
		const host = render(WEEKLY, app);

		clickWeekCell(host);
		await settle();

		// `false` is Obsidian's "reuse the active unpinned tab".
		expect(app.opened).toEqual([{ path: weekPath(), leaf: false }]);
		expect(app.created).toEqual([]);
	});

	it("AC-CAL-04.2: creates the missing week note without a prompt when the setting says so, then opens it", async () => {
		const app = new FakeApp();
		const host = render(WEEKLY, app);

		clickWeekCell(host);
		await settle();

		expect(app.created).toEqual([weekPath()]);
		expect(app.opened).toEqual([{ path: weekPath(), leaf: false }]);
	});

	it("AC-CAL-04.2: writes nothing while the confirmation the same setting asks for is unanswered", async () => {
		const app = new FakeApp();
		// The same `confirmBeforeCreate` the day cell reads, left at its default.
		const host = render({ ...WEEKLY, confirmBeforeCreate: true }, app);

		clickWeekCell(host);
		await settle();

		expect(app.created).toEqual([]);
		expect(app.opened).toEqual([]);
	});

	it("AC-CAL-04.3: opens the week's note in a split when the click carries the split modifier", async () => {
		const app = new FakeApp();
		app.seed(weekPath());
		const host = render(WEEKLY, app);

		// The mock host is not a Mac, so Ctrl is the split modifier there.
		clickWeekCell(host, { ctrlKey: true });
		await settle();

		expect(app.opened).toEqual([{ path: weekPath(), leaf: "split" }]);
	});

	it("AC-CAL-04.3: creates the missing week note first, then opens it in the split", async () => {
		const app = new FakeApp();
		const host = render(WEEKLY, app);

		clickWeekCell(host, { ctrlKey: true });
		await settle();

		expect(app.created).toEqual([weekPath()]);
		expect(app.opened).toEqual([{ path: weekPath(), leaf: "split" }]);
	});

	it("AC-CAL-04.4: hovering a week that has a note asks Page preview for that note at the cell, and opens nothing", async () => {
		const app = new FakeApp();
		app.seed(weekPath());
		const host = render(WEEKLY, app);
		const displayed = headerText(host);

		const event = hoverWeekCell(host, { ctrlKey: true });
		await settle();

		const links = hoverLinks(app);
		expect(links).toHaveLength(1);
		const request = links[0] ?? {};
		// The payload carries the hovered event as it came, so Page preview reads
		// the modifier the user actually held and owns the gate.
		expect(request.event).toBe(event);
		expect(request.source).toBe("calendaric");
		// Near the cell means anchored to the cell: the popover opens at the
		// element the user is pointing at, not at the row or the table.
		expect(request.targetEl).toBe(weekCell(host));
		expect(request.linktext).toBe(weekPath());
		expect(request.sourcePath).toBe("");
		// The widget is the hover parent, so the popover it owns closes with the pane.
		expect(request.hoverParent).toHaveProperty("hoverPopover", null);
		// A hover neither navigates nor opens.
		expect(app.opened).toEqual([]);
		expect(headerText(host)).toBe(displayed);
	});

	it("AC-CAL-04.5: hovering a week with no note previews its own path and creates no file", async () => {
		const app = new FakeApp();
		const host = render(WEEKLY, app);

		hoverWeekCell(host, { ctrlKey: true });
		await settle();

		// An unresolved linktext is what makes Obsidian's own popover say the
		// note is not there yet, so the hover never has to read the vault.
		expect(hoverLinks(app).map((request) => request.linktext)).toEqual([weekPath()]);
		expect(app.created).toEqual([]);
		expect(app.files.has(weekPath())).toBe(false);
		expect(app.opened).toEqual([]);
	});
});
