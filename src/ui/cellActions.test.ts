import { describe, it, expect } from "vitest";
import moment from "moment";
import type { Moment } from "moment";
import type { HoverParent } from "obsidian";
import {
	HOVER_LINK_SOURCE,
	hoverPreviewRequest,
	openOrCreateNote,
	splitModifierPressed,
	type CellClick,
	type CreateRequest,
} from "./cellActions";
import { getMonthGrid } from "./calendarUtils";
import { computeNotePath } from "../notes/noteUtils";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import type { PeriodicConfig } from "../types";

const dayConfig: PeriodicConfig = {
	enabled: true,
	format: "YYYY-MM-DD",
	folder: "Daily",
	templatePath: "",
	openAtStartup: false,
};

const WEEK_FORMAT = "gggg-[W]ww";

/** The day every click test uses, and the path its note lands on. */
const DAY = "2026-04-13";

function makeClick(overrides: Partial<MouseEvent> = {}): MouseEvent {
	return { metaKey: false, ctrlKey: false, ...overrides } as MouseEvent;
}

interface Ports {
	vault: FakeVaultPort;
	vaultConfig: FakeVaultConfigPort;
	workspace: FakeWorkspacePort;
}

function makePorts(existingPaths: string[] = []): Ports {
	const vault = new FakeVaultPort();
	for (const path of existingPaths) vault.seedFile(path, "");
	return { vault, vaultConfig: new FakeVaultConfigPort(), workspace: new FakeWorkspacePort() };
}

/** A confirm stub that records what it was asked and answers `answer`. */
function stubConfirm(answer: boolean, spy?: (request: CreateRequest) => void) {
	const asked: CreateRequest[] = [];
	return {
		asked,
		confirm: async (request: CreateRequest): Promise<boolean> => {
			asked.push(request);
			spy?.(request);
			return answer;
		},
	};
}

function pathFor(date: string): string {
	return computeNotePath(moment(date), dayConfig, new FakeVaultConfigPort());
}

/** A plain click on `DAY`, on a Mac, with creation unconfirmed — override one field per test. */
function clickDay(ports: Ports, overrides: Partial<CellClick> = {}): Promise<void> {
	return openOrCreateNote({
		date: moment(DAY),
		granularity: "day",
		config: dayConfig,
		confirmBeforeCreate: false,
		isMacOS: true,
		event: makeClick(),
		ports,
		confirmCreate: stubConfirm(false).confirm,
		...overrides,
	});
}

describe("splitModifierPressed", () => {
	it("AC-CAL-03.4: on macOS only Cmd splits, so Ctrl-click stays in the active pane", () => {
		expect(splitModifierPressed(makeClick({ metaKey: true }), true)).toBe(true);
		expect(splitModifierPressed(makeClick({ ctrlKey: true }), true)).toBe(false);
	});

	it("AC-CAL-03.4: off macOS only Ctrl splits", () => {
		expect(splitModifierPressed(makeClick({ ctrlKey: true }), false)).toBe(true);
		expect(splitModifierPressed(makeClick({ metaKey: true }), false)).toBe(false);
	});

	it("AC-CAL-03.1: a plain click never splits, on either platform", () => {
		expect(splitModifierPressed(makeClick(), true)).toBe(false);
		expect(splitModifierPressed(makeClick(), false)).toBe(false);
	});
});

describe("openOrCreateNote", () => {
	it("AC-CAL-03.1: opens the existing note in the active pane", async () => {
		const path = pathFor(DAY);
		const ports = makePorts([path]);

		await clickDay(ports);

		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "reuse" }]);
	});

	it("AC-CAL-03.1: does not ask to create a note that is already there", async () => {
		const path = pathFor(DAY);
		const ports = makePorts([path]);
		const confirm = stubConfirm(true);

		await clickDay(ports, { confirmBeforeCreate: true, confirmCreate: confirm.confirm });

		expect(confirm.asked).toEqual([]);
		expect(ports.vault.contentAt(path)).toBe("");
	});

	it("AC-CAL-03.2: creates and opens without a confirmation step", async () => {
		const ports = makePorts();
		const confirm = stubConfirm(false);

		await clickDay(ports, { confirmCreate: confirm.confirm });

		expect(confirm.asked).toEqual([]);
		expect(ports.vault.contentAt(pathFor(DAY))).toBe("");
		expect(ports.workspace.opened).toEqual([{ file: { path: pathFor(DAY) }, mode: "reuse" }]);
	});

	it("AC-CAL-03.3: asks first, naming the day, while the file still does not exist", async () => {
		const ports = makePorts();
		let existedWhenAsked: string | undefined = "not asked";
		const confirm = stubConfirm(false, () => {
			existedWhenAsked = ports.vault.contentAt(pathFor(DAY));
		});

		await clickDay(ports, { confirmBeforeCreate: true, confirmCreate: confirm.confirm });

		expect(existedWhenAsked).toBeUndefined();
		expect(confirm.asked).toHaveLength(1);
		expect(confirm.asked[0]!.body).toContain(moment(DAY).format("LL"));
	});

	it("AC-CAL-03.3: accepting creates the note and opens it in the active pane", async () => {
		const ports = makePorts();

		await clickDay(ports, { confirmBeforeCreate: true, confirmCreate: stubConfirm(true).confirm });

		expect(ports.vault.contentAt(pathFor(DAY))).toBe("");
		expect(ports.workspace.opened).toEqual([{ file: { path: pathFor(DAY) }, mode: "reuse" }]);
	});

	it("AC-CAL-03.3: dismissing creates nothing and opens nothing", async () => {
		const ports = makePorts();

		await clickDay(ports, { confirmBeforeCreate: true, confirmCreate: stubConfirm(false).confirm });

		expect(ports.vault.contentAt(pathFor(DAY))).toBeUndefined();
		expect(ports.vault.createdFolders).toEqual([]);
		expect(ports.workspace.opened).toEqual([]);
	});

	it("AC-CAL-03.4: a Cmd-click on a Mac opens the existing note in a split", async () => {
		const path = pathFor(DAY);
		const ports = makePorts([path]);

		await clickDay(ports, { event: makeClick({ metaKey: true }) });

		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "split" }]);
	});

	it("AC-CAL-03.4: a Ctrl-click on a Mac opens in the active pane, not a split", async () => {
		const path = pathFor(DAY);
		const ports = makePorts([path]);

		await clickDay(ports, { event: makeClick({ ctrlKey: true }) });

		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "reuse" }]);
	});

	it("AC-CAL-03.4: a Ctrl-click off macOS opens the existing note in a split", async () => {
		const path = pathFor(DAY);
		const ports = makePorts([path]);

		await clickDay(ports, { isMacOS: false, event: makeClick({ ctrlKey: true }) });

		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "split" }]);
	});

	it("AC-CAL-03.4: a modifier click creates the missing note first, then splits", async () => {
		const ports = makePorts();

		await clickDay(ports, {
			confirmBeforeCreate: true,
			confirmCreate: stubConfirm(true).confirm,
			event: makeClick({ metaKey: true }),
		});

		expect(ports.vault.contentAt(pathFor(DAY))).toBe("");
		expect(ports.workspace.opened).toEqual([{ file: { path: pathFor(DAY) }, mode: "split" }]);
	});

	it("AC-CAL-03.6: a trailing adjacent-month day opens its own month's note", async () => {
		const grid = getMonthGrid(moment("2026-04-15"), 1, WEEK_FORMAT);
		const trailing = grid.at(-1)!.days.find((day) => day.isAdjacentMonth)!;
		const ports = makePorts();

		await clickDay(ports, { date: trailing.date });

		expect(trailing.date.month()).toBe(4);
		expect(ports.workspace.opened).toEqual([
			{ file: { path: `Daily/${trailing.date.format("YYYY-MM-DD")}.md` }, mode: "reuse" },
		]);
	});

	it("AC-CAL-03.6: leaves the clicked cell's own date untouched, so the grid keeps its month", async () => {
		const grid = getMonthGrid(moment("2026-04-15"), 1, WEEK_FORMAT);
		const leading: Moment = grid[0]!.days[0]!.date;
		const before = leading.format();

		await clickDay(makePorts(), { date: leading });

		expect(leading.format()).toBe(before);
	});

	it("AC-CAL-03.2: opens the winner's note when another activation creates it first", async () => {
		const ports = makePorts();
		// The confirmation is the await the second activation slips through: the note
		// appears between this activation's own look and its write.
		const confirm = stubConfirm(true, () => {
			ports.vault.seedFile(pathFor(DAY), "written by the other click");
		});

		await clickDay(ports, { confirmBeforeCreate: true, confirmCreate: confirm.confirm });

		expect(ports.vault.contentAt(pathFor(DAY))).toBe("written by the other click");
		expect(ports.workspace.opened).toEqual([{ file: { path: pathFor(DAY) }, mode: "reuse" }]);
	});

	it("AC-CAL-03.2: two concurrent clicks on the same day both open the one note", async () => {
		const ports = makePorts();

		await Promise.all([clickDay(ports), clickDay(ports)]);

		const expected = { file: { path: pathFor(DAY) }, mode: "reuse" };
		expect(ports.workspace.opened).toEqual([expected, expected]);
	});

	it("AC-CAL-03.2: rethrows a create failure that left no note behind", async () => {
		const ports = makePorts();
		ports.vault.createFileError = new Error("vault is read-only");

		await expect(clickDay(ports)).rejects.toThrow("vault is read-only");
		expect(ports.workspace.opened).toEqual([]);
	});

	it("AC-CAL-03.2: refuses to create when a folder already occupies the note's path", async () => {
		const ports = makePorts();
		ports.vault.seedFolder(pathFor(DAY));

		await expect(clickDay(ports)).rejects.toThrow(/folder already uses/);
		expect(ports.vault.contentAt(pathFor(DAY))).toBeUndefined();
		expect(ports.workspace.opened).toEqual([]);
	});
});

describe("hoverPreviewRequest", () => {
	const hoverParent = { hoverPopover: null } as HoverParent;
	const targetEl = {} as HTMLElement;

	it("AC-CAL-03.5: asks Obsidian to preview the note under the hovered cell", () => {
		const notePath = pathFor(DAY);

		const request = hoverPreviewRequest({
			event: makeClick({ metaKey: true }),
			hoverParent,
			targetEl,
			notePath,
		});

		expect(request).toEqual({
			event: expect.objectContaining({ metaKey: true }),
			source: HOVER_LINK_SOURCE,
			hoverParent,
			targetEl,
			linktext: notePath,
			sourcePath: "",
		});
	});

	it("AC-CAL-03.5: emits on a plain hover too, leaving the modifier gate to Page preview", () => {
		const request = hoverPreviewRequest({
			event: makeClick(),
			hoverParent,
			targetEl,
			notePath: pathFor(DAY),
		});

		expect(request.source).toBe(HOVER_LINK_SOURCE);
		expect(request.linktext).toBe(pathFor(DAY));
	});

	it("AC-CAL-03.7: previews the missing note's own path and writes nothing", () => {
		const ports = makePorts();
		const notePath = pathFor(DAY);

		const request = hoverPreviewRequest({
			event: makeClick({ metaKey: true }),
			hoverParent,
			targetEl,
			notePath,
		});

		expect(request.linktext).toBe(notePath);
		expect(ports.vault.contentAt(notePath)).toBeUndefined();
		expect(ports.vault.createdFolders).toEqual([]);
	});
});
