// @vitest-environment happy-dom
//
// The grid while it stays open: notes created, deleted, renamed and edited
// elsewhere, and settings saved elsewhere, all show up without the user
// touching the view (US-CAL-09). Each change is reported the way the vault
// adapter reports it, through the fake port's `emitChange`.
import { describe, it, expect, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import type CalendaricPlugin from "../main";
import { CalendarWidget } from "./calendar";
import { CalendarView } from "./CalendarView";
import { getMonthGrid, getWeekAnchor } from "./calendarUtils";
import { computeNotePath } from "../notes/noteUtils";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { DEFAULT_SETTINGS } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";
import type { PeriodicConfig } from "../types";

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const firstOfMonth = () => window.moment().startOf("month");
const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

function dayPath(dayOfMonth: number, config: PeriodicConfig = SETTINGS.day): string {
	return computeNotePath(firstOfMonth().add(dayOfMonth - 1, "day"), "day", config, new FakeVaultConfigPort());
}

function rowWeekPath(row: number): string {
	const grid = getMonthGrid(firstOfMonth(), 1, SETTINGS.week.format);
	return computeNotePath(getWeekAnchor(grid[row]!.days), "week", SETTINGS.week, new FakeVaultConfigPort());
}
const secondRowWeekPath = () => rowWeekPath(1);

async function open(notes: Record<string, string> = {}, vault = new FakeVaultPort()) {
	for (const [path, content] of Object.entries(notes)) vault.seedFile(path, content);
	const host = document.createElement("div");
	const widget = new CalendarWidget(host, eventOnlyApp(), SETTINGS, {
		vault,
		vaultConfig: new FakeVaultConfigPort(),
		workspace: new FakeWorkspacePort(),
	});
	await settle();
	return { vault, host, widget };
}

function dayCell(host: HTMLElement, dayOfMonth: number): HTMLElement {
	const cell = Array.from(host.querySelectorAll<HTMLElement>(".calendaric-day:not(.is-adjacent-month)"))
		.find((el) => el.firstChild?.textContent === String(dayOfMonth));
	if (!cell) throw new Error(`no cell for day ${dayOfMonth}`);
	return cell;
}

const weekCell = (host: HTMLElement, row: number) => host.querySelectorAll<HTMLElement>(".calendaric-weeknum")[row]!;
const existsDots = (el: HTMLElement) => el.querySelectorAll(".calendaric-dot--exists").length;
const filledSegments = (el: HTMLElement) => el.querySelectorAll(".calendaric-dot--words .is-filled").length;

describe("US-CAL-09: vault changes reach the open grid", () => {
	it("AC-CAL-09.1: a day or week note created elsewhere gains its cell's dot with no interaction", async () => {
		const { vault, host } = await open();
		expect(existsDots(dayCell(host, 5))).toBe(0);
		expect(existsDots(weekCell(host, 1))).toBe(0);

		vault.seedFile(dayPath(5), "");
		vault.emitChange({ kind: "create", file: { path: dayPath(5) } });
		vault.seedFile(secondRowWeekPath(), "");
		vault.emitChange({ kind: "create", file: { path: secondRowWeekPath() } });

		expect(existsDots(dayCell(host, 5))).toBe(1);
		expect(existsDots(weekCell(host, 1))).toBe(1);
	});

	it("AC-CAL-09.2: a day or week note deleted elsewhere loses its cell's dot with no interaction", async () => {
		const { vault, host } = await open({ [dayPath(5)]: "", [secondRowWeekPath()]: "" });
		expect(existsDots(dayCell(host, 5))).toBe(1);
		expect(existsDots(weekCell(host, 1))).toBe(1);

		vault.deleteFile(dayPath(5));
		vault.emitChange({ kind: "delete", file: { path: dayPath(5) } });
		vault.deleteFile(secondRowWeekPath());
		vault.emitChange({ kind: "delete", file: { path: secondRowWeekPath() } });

		expect(existsDots(dayCell(host, 5))).toBe(0);
		expect(existsDots(weekCell(host, 1))).toBe(0);
	});

	it("AC-CAL-09.3: a rename moves the dot from the old date's cell to the new one", async () => {
		const { vault, host } = await open({ [dayPath(5)]: "" });

		vault.renameFile(dayPath(5), dayPath(9));
		vault.emitChange({ kind: "rename", file: { path: dayPath(9) }, oldPath: dayPath(5) });

		expect(existsDots(dayCell(host, 5))).toBe(0);
		expect(existsDots(dayCell(host, 9))).toBe(1);
	});

	it("AC-CAL-09.3: a week note's rename moves the dot from the old row to the new one", async () => {
		const { vault, host } = await open({ [rowWeekPath(1)]: "" });

		vault.renameFile(rowWeekPath(1), rowWeekPath(3));
		vault.emitChange({ kind: "rename", file: { path: rowWeekPath(3) }, oldPath: rowWeekPath(1) });

		expect(existsDots(weekCell(host, 1))).toBe(0);
		expect(existsDots(weekCell(host, 3))).toBe(1);
	});

	it("AC-CAL-09.3: a rename to a name that matches no date removes the dot and adds none", async () => {
		const { vault, host } = await open({ [dayPath(5)]: "" });

		vault.renameFile(dayPath(5), "meeting notes.md");
		vault.emitChange({ kind: "rename", file: { path: "meeting notes.md" }, oldPath: dayPath(5) });

		expect(existsDots(host)).toBe(0);
	});

	it("an edit to a shown note's text redraws that cell's word-count dot", async () => {
		const { vault, host } = await open({ [dayPath(5)]: words(250) });
		expect(filledSegments(dayCell(host, 5))).toBe(1);

		// The host reports a finished edit as a metadata change.
		vault.seedFile(dayPath(5), words(1250));
		vault.emitChange({ kind: "metadata", file: { path: dayPath(5) } });
		await settle();

		expect(filledSegments(dayCell(host, 5))).toBe(5);
	});

	it("an edit to a note the grid does not show does not re-scan the month", async () => {
		const { vault } = await open({ [dayPath(5)]: words(250), "inbox.md": "" });
		const scans = vi.spyOn(vault, "pathExists");

		vault.emitChange({ kind: "metadata", file: { path: "inbox.md" } });

		expect(scans).not.toHaveBeenCalled();
	});

	it("an edit saved while the render is still reading that note redraws its word-count dot", async () => {
		const vault = new FakeVaultPort();
		const realRead = vault.readFile.bind(vault);
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		vi.spyOn(vault, "readFile").mockImplementationOnce(async (file) => {
			const text = await realRead(file);
			await held;
			return text;
		});
		const { host } = await open({ [dayPath(5)]: words(250) }, vault);

		vault.seedFile(dayPath(5), words(1250));
		vault.emitChange({ kind: "metadata", file: { path: dayPath(5) } });
		release();
		await settle();

		expect(filledSegments(dayCell(host, 5))).toBe(5);
	});

	it("an edit that leaves a shown note's word-count dot as it was does not re-scan the month", async () => {
		const { vault } = await open({ [dayPath(5)]: words(250) });
		const scans = vi.spyOn(vault, "pathExists");

		vault.seedFile(dayPath(5), words(260));
		vault.emitChange({ kind: "metadata", file: { path: dayPath(5) } });
		await settle();

		expect(scans).not.toHaveBeenCalled();
	});

	it("a created note renders once, not again when the host parses it", async () => {
		const { vault, host } = await open();
		vault.seedFile(dayPath(5), words(250));
		vault.emitChange({ kind: "create", file: { path: dayPath(5) } });
		await settle();
		const scans = vi.spyOn(vault, "pathExists");

		vault.emitChange({ kind: "metadata", file: { path: dayPath(5) } });
		await settle();

		expect(scans).not.toHaveBeenCalled();
		expect(filledSegments(dayCell(host, 5))).toBe(1);
	});
});

describe("US-CAL-09: saved settings reach the open grid", () => {
	it("AC-CAL-09.4: a saved display setting re-renders the grid at once", async () => {
		// Driven from the view, the hop the plugin calls after a save.
		const plugin = { settings: SETTINGS } as CalendaricPlugin;
		const view = new CalendarView({} as WorkspaceLeaf, plugin, {
			vault: new FakeVaultPort(),
			vaultConfig: new FakeVaultConfigPort(),
			workspace: new FakeWorkspacePort(),
		});
		const host = document.createElement("div");
		const pane = document.createElement("div");
		pane.append(document.createElement("div"), host);
		Object.assign(view, { app: eventOnlyApp(), containerEl: pane, registerInterval: () => 0 });
		await view.onOpen();
		expect(host.querySelector(".calendaric-weeknum-header")).not.toBeNull();

		plugin.settings = { ...SETTINGS, showWeekNumbers: false };
		view.refresh();

		expect(host.querySelector(".calendaric-weeknum-header")).toBeNull();
		expect(host.querySelectorAll(".calendaric-weeknum").length).toBe(0);
	});

	it("AC-CAL-09.5: a changed format or folder re-scans the notes and redraws the dots", async () => {
		const moved: PeriodicConfig = { ...SETTINGS.day, format: "DD-MM-YYYY", folder: "Journal" };
		const { host, widget } = await open({ [dayPath(5)]: "", [dayPath(7, moved)]: "" });
		expect(existsDots(dayCell(host, 5))).toBe(1);
		expect(existsDots(dayCell(host, 7))).toBe(0);

		widget.refreshSettings({ ...SETTINGS, day: moved });

		expect(existsDots(dayCell(host, 5))).toBe(0);
		expect(existsDots(dayCell(host, 7))).toBe(1);
	});

	it("AC-CAL-09.5: a granularity switched off drops its dots", async () => {
		const { host, widget } = await open({ [dayPath(5)]: "", [secondRowWeekPath()]: "" });

		widget.refreshSettings({
			...SETTINGS,
			day: { ...SETTINGS.day, enabled: false },
			week: { ...SETTINGS.week, enabled: false },
		});

		expect(existsDots(host)).toBe(0);
	});
});
