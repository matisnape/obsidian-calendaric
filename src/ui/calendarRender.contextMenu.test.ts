// @vitest-environment happy-dom
//
// Right-clicking a day or week cell (US-CAL-06). Two hosts: the fake workspace
// port, which records what the widget asked for, and the real workspace adapter
// over a fake `App`, which shows the ask reaching Obsidian's `file-menu` event —
// the event other plugins and Obsidian's own Delete item hook into.
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { CalendarWidget } from "./calendar";
import { getMonthGrid, getWeekAnchor } from "./calendarUtils";
import { computeNotePath } from "../notes/noteUtils";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { ObsidianVaultAdapter } from "../adapters/obsidianVaultAdapter";
import { ObsidianVaultConfigAdapter } from "../adapters/obsidianVaultConfigAdapter";
import { ObsidianWorkspaceAdapter } from "../adapters/obsidianWorkspaceAdapter";
import { DEFAULT_SETTINGS } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";

const SETTINGS: CalendaricSettings = {
	...DEFAULT_SETTINGS,
	showWeekNumbers: true,
	weekStart: "monday",
	day: { ...DEFAULT_SETTINGS.day, enabled: true, format: "YYYY-MM-DD" },
	week: { ...DEFAULT_SETTINGS.week, enabled: true, format: "gggg-[W]ww" },
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const firstOfMonth = () => window.moment().startOf("month");

function dayPath(dayOfMonth: number): string {
	return computeNotePath(firstOfMonth().add(dayOfMonth - 1, "day"), SETTINGS.day, new FakeVaultConfigPort(), "day");
}

function weekPath(row: number): string {
	const grid = getMonthGrid(firstOfMonth(), 1, SETTINGS.week.format);
	return computeNotePath(getWeekAnchor(grid[row]!.days), SETTINGS.week, new FakeVaultConfigPort(), "week");
}

function dayCell(host: HTMLElement, dayOfMonth: number): HTMLElement {
	const cell = Array.from(host.querySelectorAll<HTMLElement>(".calendaric-day:not(.is-adjacent-month)"))
		.find((el) => el.firstChild?.textContent === String(dayOfMonth));
	if (!cell) throw new Error(`no cell for day ${dayOfMonth}`);
	return cell;
}

const weekCell = (host: HTMLElement, row: number) => host.querySelectorAll<HTMLElement>(".calendaric-weeknum")[row]!;
const existsDots = (el: HTMLElement) => el.querySelectorAll(".calendaric-dot--exists").length;

function rightClick(el: HTMLElement): MouseEvent {
	const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 });
	el.dispatchEvent(event);
	return event;
}

function withFakes(paths: string[]) {
	const vault = new FakeVaultPort();
	for (const path of paths) vault.seedFile(path, "");
	const workspace = new FakeWorkspacePort();
	const app = {
		workspace: { on: (): object => ({}), offref: (): undefined => undefined, trigger: (): undefined => undefined },
	} as unknown as App;
	const host = document.createElement("div");
	new CalendarWidget(host, app, SETTINGS, { vault, vaultConfig: new FakeVaultConfigPort(), workspace });
	return { vault, workspace, host };
}

function withRealAdapters(paths: string[]) {
	const files = new Map<string, TFile>();
	for (const path of paths) {
		const file = new TFile();
		file.path = path;
		files.set(path, file);
	}
	const triggered: unknown[][] = [];
	const app = {
		workspace: {
			on: (): object => ({}),
			offref: (): undefined => undefined,
			trigger: (...args: unknown[]): void => {
				triggered.push(args);
			},
		},
		metadataCache: { on: (): object => ({}), offref: (): undefined => undefined, getFileCache: (): null => null },
		vault: {
			on: (): object => ({}),
			offref: (): undefined => undefined,
			config: {},
			getAbstractFileByPath: (path: string): TFile | null => files.get(path) ?? null,
			getMarkdownFiles: (): TFile[] => [...files.values()],
		},
	} as unknown as App;
	const host = document.createElement("div");
	new CalendarWidget(host, app, SETTINGS, {
		vault: new ObsidianVaultAdapter(app),
		vaultConfig: new ObsidianVaultConfigAdapter(app),
		workspace: new ObsidianWorkspaceAdapter(app),
	});
	const fileMenus = () => triggered.filter((args) => args[0] === "file-menu");
	return { files, host, fileMenus };
}

describe("US-CAL-06: right-click a day or week cell for file actions", () => {
	it("AC-CAL-06.1: right-clicking a day or week cell that has a note asks for that note's file menu at the click", () => {
		const { workspace, host } = withFakes([dayPath(5), weekPath(1)]);

		const onDay = rightClick(dayCell(host, 5));
		const onWeek = rightClick(weekCell(host, 1));

		expect(workspace.fileMenus.map(({ file }) => file.path)).toEqual([dayPath(5), weekPath(1)]);
		expect(workspace.fileMenus.map(({ event }) => event)).toEqual([onDay, onWeek]);
		// Obsidian's own browser menu must not open on top of the file menu.
		expect(onDay.defaultPrevented).toBe(true);
		expect(onWeek.defaultPrevented).toBe(true);
	});

	it("AC-CAL-06.1: the adapter shows the note's file menu at the right-click event", () => {
		const { files, host, fileMenus } = withRealAdapters([dayPath(5), weekPath(1)]);

		const onDay = rightClick(dayCell(host, 5));
		const onWeek = rightClick(weekCell(host, 1));

		const menus = fileMenus();
		expect(menus.map(([, , file]) => file)).toEqual([files.get(dayPath(5)), files.get(weekPath(1))]);
		// The fake Menu records the event it was shown at; the position comes from the event.
		expect(menus.map(([, menu]) => (menu as { shownAtEvent: MouseEvent | null }).shownAtEvent)).toEqual([
			onDay,
			onWeek,
		]);
	});

	it("AC-CAL-06.2: right-clicking a day or week cell with no note opens no menu", () => {
		const fakes = withFakes([]);
		const onDay = rightClick(dayCell(fakes.host, 5));
		const onWeek = rightClick(weekCell(fakes.host, 1));
		expect(fakes.workspace.fileMenus).toEqual([]);
		// Nothing was claimed, so the browser's own menu still belongs here.
		expect(onDay.defaultPrevented).toBe(false);
		expect(onWeek.defaultPrevented).toBe(false);

		const real = withRealAdapters([]);
		rightClick(dayCell(real.host, 5));
		rightClick(weekCell(real.host, 1));
		expect(real.fileMenus()).toEqual([]);
	});

	it("AC-CAL-06.3: the menu is built through Obsidian's file-menu event, carrying the vault's own file", () => {
		const { files, host, fileMenus } = withRealAdapters([dayPath(5)]);

		rightClick(dayCell(host, 5));

		// `file-menu` is the event every plugin's file actions and Obsidian's own
		// Delete hook into; the vault's object, not a copy, is what they act on.
		const [menu] = fileMenus();
		expect(menu?.[0]).toBe("file-menu");
		expect(menu?.[2]).toBe(files.get(dayPath(5)));
		expect(menu?.[3]).toBe("calendaric");
	});

	it("AC-CAL-06.4: deleting the note from its cell's menu removes that cell's dot once the delete lands", async () => {
		const { vault, workspace, host } = withFakes([dayPath(5), weekPath(1)]);
		await settle();
		expect(existsDots(dayCell(host, 5))).toBe(1);
		expect(existsDots(weekCell(host, 1))).toBe(1);

		rightClick(dayCell(host, 5));
		rightClick(weekCell(host, 1));
		// Obsidian's Delete item removes the file and the vault reports it.
		for (const { file } of workspace.fileMenus) {
			vault.deleteFile(file.path);
			vault.emitChange({ kind: "delete", file });
		}

		expect(existsDots(dayCell(host, 5))).toBe(0);
		expect(existsDots(weekCell(host, 1))).toBe(0);
	});
});
