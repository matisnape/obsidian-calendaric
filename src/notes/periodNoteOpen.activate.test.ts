// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { openOrCreatePeriodNote } from "./periodNoteOpen";
import { PeriodicNoteIndex } from "./periodicNoteIndex";
import { openOrCreateNote, type CreateRequest } from "../ui/cellActions";
import { DEFAULT_PERIODIC_CONFIG } from "../types";
import type { App } from "obsidian";
import { CalendarWidget } from "../ui/calendar";
import { DEFAULT_SETTINGS } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";
import type { PeriodicConfig } from "../types";

/**
 * US-NOTE-07 through both ways a period is activated: the calendar cell click
 * (`openOrCreateNote`) and the command path (`openOrCreatePeriodNote`), which
 * the jump, open-neighbour and open-current commands all share.
 */

window.moment.locale("en");

const DAY = "2026-04-13";
const PATH = "Daily/2026-04-13.md";

const dayConfig: PeriodicConfig = { ...DEFAULT_PERIODIC_CONFIG, enabled: true, format: "YYYY-MM-DD", folder: "Daily" };

function makePorts() {
	return { vault: new FakeVaultPort(), vaultConfig: new FakeVaultConfigPort(""), workspace: new FakeWorkspacePort() };
}
type Ports = ReturnType<typeof makePorts>;

/** A confirm stub that records every question and answers `answer`. */
function stubConfirm(answer: boolean) {
	const asked: CreateRequest[] = [];
	return { asked, confirm: async (request: CreateRequest) => (asked.push(request), answer) };
}

/** Everything in the fake vault, by path, so "nothing changed" is one comparison. */
function snapshot(vault: FakeVaultPort): Record<string, string | undefined> {
	return Object.fromEntries(vault.listNotes().map((file) => [file.path, vault.contentAt(file.path)]));
}

function click(ports: Ports, confirmBeforeCreate: boolean, confirm = stubConfirm(true), config = dayConfig, date = DAY) {
	return openOrCreateNote({
		date: window.moment(date),
		granularity: config === dayConfig ? "day" : "week",
		config,
		confirmBeforeCreate,
		event: { metaKey: false, ctrlKey: false } as MouseEvent,
		ports,
		confirmCreate: confirm.confirm,
	});
}

function command(ports: Ports, existing = ports.vault.getFile(PATH)) {
	return openOrCreatePeriodNote("day", window.moment(DAY), dayConfig, existing, ports);
}

const openedPaths = (ports: Ports) => ports.workspace.opened.map((entry) => entry.file.path);

/** Settings for the calendar pane, confirmation off so a click writes at once. */
const SETTINGS: CalendaricSettings = { ...DEFAULT_SETTINGS, confirmBeforeCreate: false, showWeekNumbers: true, weekStart: "monday" };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	vi.useRealTimers();
});

/**
 * A calendar pane over the fakes, showing the month `date` falls in: the pane
 * opens on today's month, so the clock is set to `date` (timers stay real).
 */
function renderCalendar(ports: Ports, settings: CalendaricSettings, date: string): HTMLElement {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(`${date}T12:00:00`));
	const app = {
		workspace: { on: (): object => ({}), offref: (): undefined => undefined, trigger: (): undefined => undefined },
	} as unknown as App;
	const host = document.createElement("div");
	new CalendarWidget(host, app, settings, ports);
	return host;
}

function dayCellOf(host: HTMLElement, dayOfMonth: number): HTMLElement {
	const cell = Array.from(host.querySelectorAll<HTMLElement>(".calendaric-day:not(.is-adjacent-month)")).find(
		(el) => el.firstChild?.textContent === String(dayOfMonth),
	);
	if (!cell) throw new Error(`no cell for day ${dayOfMonth}`);
	return cell;
}

describe("AC-NOTE-07.1: a period with no note gets one, and it opens", () => {
	it("AC-NOTE-07.1: the cell click creates the missing note and opens it", async () => {
		const ports = makePorts();

		await click(ports, false);

		expect(ports.vault.getFile(PATH)).not.toBeNull();
		expect(openedPaths(ports)).toEqual([PATH]);
	});

	it("AC-NOTE-07.1: the command creates the missing note and opens it", async () => {
		const ports = makePorts();

		await command(ports);

		expect(ports.vault.getFile(PATH)).not.toBeNull();
		expect(openedPaths(ports)).toEqual([PATH]);
	});
});

describe("AC-NOTE-07.2: a period that has a note opens that note untouched", () => {
	it("AC-NOTE-07.2: the cell click opens the existing note without asking, writes no second file and leaves its content byte-identical", async () => {
		const ports = makePorts();
		ports.vault.seedFile(PATH, "# Monday\n\nwritten by hand\n");
		const before = snapshot(ports.vault);
		const confirm = stubConfirm(true);

		await click(ports, true, confirm);

		expect(snapshot(ports.vault)).toEqual(before);
		expect(openedPaths(ports)).toEqual([PATH]);
		// An existing note is not a creation, so confirmation never comes into it.
		expect(confirm.asked).toEqual([]);
	});

	it("AC-NOTE-07.2: the command opens the existing note, writes no second file and leaves its content byte-identical", async () => {
		const ports = makePorts();
		ports.vault.seedFile(PATH, "# Monday\n\nwritten by hand\n");
		const before = snapshot(ports.vault);

		await command(ports);

		expect(snapshot(ports.vault)).toEqual(before);
		expect(openedPaths(ports)).toEqual([PATH]);
	});
});

describe("AC-NOTE-07.3: with confirmation on, nothing is written before the user agrees", () => {
	it("AC-NOTE-07.3: the cell click asks before writing, and declining writes nothing and opens nothing", async () => {
		const ports = makePorts();
		const confirm = stubConfirm(false);

		await click(ports, true, confirm);

		expect(confirm.asked).toHaveLength(1);
		expect(ports.vault.listNotes()).toEqual([]);
		expect(ports.vault.folderExists("Daily")).toBe(false);
		expect(ports.workspace.opened).toEqual([]);
	});

	it("AC-NOTE-07.3: the question is asked while the vault is still empty", async () => {
		const ports = makePorts();
		let notesWhenAsked: number | null = null;

		await click(ports, true, {
			asked: [],
			confirm: async () => {
				notesWhenAsked = ports.vault.listNotes().length;
				return true;
			},
		});

		expect(notesWhenAsked).toBe(0);
		expect(openedPaths(ports)).toEqual([PATH]);
	});
});

describe("AC-NOTE-07.4: with confirmation off, the note is created and opened at once", () => {
	it("AC-NOTE-07.4: the cell click shows no prompt at all and opens the new note", async () => {
		const ports = makePorts();
		const confirm = stubConfirm(false);

		await click(ports, false, confirm);

		expect(confirm.asked).toEqual([]);
		expect(ports.vault.getFile(PATH)).not.toBeNull();
		expect(openedPaths(ports)).toEqual([PATH]);
	});
});

describe("AC-NOTE-07.5: a note that cannot be created says so and opens no pane", () => {
	const FAILURE = "Calendaric could not create the daily note for 2026-04-13: vault is read-only";

	// The click's last stop is the calendar's own handler, which turns the
	// rejection into the notice; `openOrCreateNote` keeps the cause as it was.
	it("AC-NOTE-07.5: the cell click names the period, says the note could not be created, and opens nothing", async () => {
		const ports = makePorts();
		ports.vault.createFileError = new Error("vault is read-only");
		const host = renderCalendar(ports, { ...SETTINGS, day: dayConfig }, DAY);

		dayCellOf(host, 13).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle();

		expect(ports.workspace.notices).toEqual([FAILURE]);
		expect(ports.workspace.opened).toEqual([]);
	});

	it("AC-NOTE-07.5: an open that fails on a note that does exist is not reported as a failed creation", async () => {
		const ports = makePorts();
		ports.vault.seedFile(PATH, "");
		ports.workspace.openInLeaf = async () => {
			throw new Error("leaf refused");
		};
		const host = renderCalendar(ports, { ...SETTINGS, day: dayConfig }, DAY);

		dayCellOf(host, 13).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle();

		expect(ports.workspace.notices).toEqual(["leaf refused"]);
	});

	it("AC-NOTE-07.5: the command names the period, says the note could not be created, and opens nothing", async () => {
		const ports = makePorts();
		ports.vault.createFileError = new Error("vault is read-only");

		await command(ports, null);

		expect(ports.workspace.notices).toEqual([FAILURE]);
		expect(ports.workspace.opened).toEqual([]);
	});
});

describe("AC-NOTE-07.6: a pretty-named weekly note under prefix matching is the week's note", () => {
	const PRETTY = "2025-W46, 10.11 - 16.11.md";
	const RAW = "2025-W46.md";
	const weekConfig: PeriodicConfig = {
		...DEFAULT_PERIODIC_CONFIG,
		enabled: true,
		format: "GGGG-[W]WW",
		folder: "",
		allowPrefixMatch: true,
	};

	function prettyVault() {
		const ports = makePorts();
		ports.vault.seedFile(PRETTY, "the week, by hand\n");
		return ports;
	}

	it("AC-NOTE-07.6: the command opens the pretty-named file the index finds and creates no raw-named duplicate", async () => {
		const ports = prettyVault();
		const index = new PeriodicNoteIndex(ports.vault, ports.vaultConfig, { week: weekConfig });
		const date = window.moment("2025-11-12");

		await openOrCreatePeriodNote("week", date, weekConfig, index.get("week", date), ports);

		expect(openedPaths(ports)).toEqual([PRETTY]);
		expect(ports.vault.getFile(RAW)).toBeNull();
		expect(ports.vault.listNotes().map((file) => file.path)).toEqual([PRETTY]);
	});

	it("AC-NOTE-07.6: the week cell click opens the pretty-named file and creates no raw-named duplicate", async () => {
		const ports = prettyVault();
		const host = renderCalendar(ports, { ...SETTINGS, week: weekConfig }, "2025-11-10");
		// The row holding Monday 10 November, the week the pretty file is for.
		const row = Array.from(host.querySelectorAll("tr")).find((tr) =>
			Array.from(tr.querySelectorAll(".calendaric-day:not(.is-adjacent-month)")).some((el) => el.firstChild?.textContent === "10"),
		);
		const weekCell = row?.querySelector<HTMLElement>(".calendaric-weeknum");
		if (!weekCell) throw new Error("no week cell for 10 November");

		weekCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle();

		expect(openedPaths(ports)).toEqual([PRETTY]);
		expect(ports.vault.getFile(RAW)).toBeNull();
	});
});
