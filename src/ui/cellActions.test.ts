import { describe, it, expect } from "vitest";
import moment from "moment";
import type { HoverParent } from "obsidian";
import {
	HOVER_LINK_SOURCE,
	openOrCreateNote,
	planHoverPreview,
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

function makeClick(overrides: Partial<MouseEvent> = {}): MouseEvent {
	return { metaKey: false, ctrlKey: false, ...overrides } as MouseEvent;
}

function makePorts(existingPaths: string[] = []) {
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

describe("openOrCreateNote", () => {
	it("AC-CAL-03.1: opens the existing note in the active pane", async () => {
		const path = pathFor("2026-04-13");
		const ports = makePorts([path]);

		await openOrCreateNote({
			date: moment("2026-04-13"),
			granularity: "day",
			config: dayConfig,
			confirmBeforeCreate: true,
			event: makeClick(),
			ports,
			confirmCreate: stubConfirm(false).confirm,
		});

		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "reuse" }]);
	});

	it("AC-CAL-03.1: does not ask to create a note that is already there", async () => {
		const path = pathFor("2026-04-13");
		const ports = makePorts([path]);
		const confirm = stubConfirm(true);

		await openOrCreateNote({
			date: moment("2026-04-13"),
			granularity: "day",
			config: dayConfig,
			confirmBeforeCreate: true,
			event: makeClick(),
			ports,
			confirmCreate: confirm.confirm,
		});

		expect(confirm.asked).toEqual([]);
		expect(ports.vault.contentAt(path)).toBe("");
	});

	it("AC-CAL-03.2: creates and opens without a confirmation step", async () => {
		const ports = makePorts();
		const confirm = stubConfirm(false);

		await openOrCreateNote({
			date: moment("2026-04-13"),
			granularity: "day",
			config: dayConfig,
			confirmBeforeCreate: false,
			event: makeClick(),
			ports,
			confirmCreate: confirm.confirm,
		});

		const path = pathFor("2026-04-13");
		expect(confirm.asked).toEqual([]);
		expect(ports.vault.contentAt(path)).toBe("");
		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "reuse" }]);
	});

	it("AC-CAL-03.3: asks first, naming the day, while the file still does not exist", async () => {
		const ports = makePorts();
		const path = pathFor("2026-04-13");
		let existedWhenAsked: string | undefined = "not asked";
		const confirm = stubConfirm(false, () => {
			existedWhenAsked = ports.vault.contentAt(path);
		});

		await openOrCreateNote({
			date: moment("2026-04-13"),
			granularity: "day",
			config: dayConfig,
			confirmBeforeCreate: true,
			event: makeClick(),
			ports,
			confirmCreate: confirm.confirm,
		});

		expect(existedWhenAsked).toBeUndefined();
		expect(confirm.asked).toHaveLength(1);
		expect(confirm.asked[0]!.body).toContain(moment("2026-04-13").format("LL"));
	});

	it("AC-CAL-03.3: accepting creates the note and opens it in the active pane", async () => {
		const ports = makePorts();

		await openOrCreateNote({
			date: moment("2026-04-13"),
			granularity: "day",
			config: dayConfig,
			confirmBeforeCreate: true,
			event: makeClick(),
			ports,
			confirmCreate: stubConfirm(true).confirm,
		});

		const path = pathFor("2026-04-13");
		expect(ports.vault.contentAt(path)).toBe("");
		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "reuse" }]);
	});

	it("AC-CAL-03.3: dismissing creates nothing and opens nothing", async () => {
		const ports = makePorts();

		await openOrCreateNote({
			date: moment("2026-04-13"),
			granularity: "day",
			config: dayConfig,
			confirmBeforeCreate: true,
			event: makeClick(),
			ports,
			confirmCreate: stubConfirm(false).confirm,
		});

		expect(ports.vault.contentAt(pathFor("2026-04-13"))).toBeUndefined();
		expect(ports.vault.createdFolders).toEqual([]);
		expect(ports.workspace.opened).toEqual([]);
	});

	it("AC-CAL-03.4: a modifier click opens the existing note in a split", async () => {
		const path = pathFor("2026-04-13");
		const ports = makePorts([path]);

		await openOrCreateNote({
			date: moment("2026-04-13"),
			granularity: "day",
			config: dayConfig,
			confirmBeforeCreate: true,
			event: makeClick({ metaKey: true }),
			ports,
			confirmCreate: stubConfirm(false).confirm,
		});

		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "split" }]);
	});

	it("AC-CAL-03.4: a modifier click creates the missing note first, then splits", async () => {
		const ports = makePorts();

		await openOrCreateNote({
			date: moment("2026-04-13"),
			granularity: "day",
			config: dayConfig,
			confirmBeforeCreate: true,
			event: makeClick({ ctrlKey: true }),
			ports,
			confirmCreate: stubConfirm(true).confirm,
		});

		const path = pathFor("2026-04-13");
		expect(ports.vault.contentAt(path)).toBe("");
		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "split" }]);
	});

	it("AC-CAL-03.6: a trailing adjacent-month day opens its own month's note", async () => {
		const grid = getMonthGrid(moment("2026-04-15"), 1, WEEK_FORMAT);
		const trailing = grid.at(-1)!.days.find((day) => day.isAdjacentMonth)!;
		const ports = makePorts();

		await openOrCreateNote({
			date: trailing.date,
			granularity: "day",
			config: dayConfig,
			confirmBeforeCreate: false,
			event: makeClick(),
			ports,
			confirmCreate: stubConfirm(false).confirm,
		});

		const path = `Daily/${trailing.date.format("YYYY-MM-DD")}.md`;
		expect(trailing.date.month()).toBe(4);
		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "reuse" }]);
	});

	it("AC-CAL-03.6: leaves the clicked cell's own date untouched, so the grid keeps its month", async () => {
		const grid = getMonthGrid(moment("2026-04-15"), 1, WEEK_FORMAT);
		const leading = grid[0]!.days[0]!;
		const before = leading.date.format();

		await openOrCreateNote({
			date: leading.date,
			granularity: "day",
			config: dayConfig,
			confirmBeforeCreate: false,
			event: makeClick(),
			ports: makePorts(),
			confirmCreate: stubConfirm(false).confirm,
		});

		expect(leading.date.format()).toBe(before);
	});
});

describe("planHoverPreview", () => {
	const hoverParent = { hoverPopover: null } as HoverParent;
	const targetEl = {} as HTMLElement;

	it("AC-CAL-03.5: asks Obsidian to preview the note under the hovered cell", () => {
		const notePath = pathFor("2026-04-13");

		const request = planHoverPreview({
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

	it("AC-CAL-03.5: a hover without the preview modifier asks for nothing", () => {
		const request = planHoverPreview({
			event: makeClick(),
			hoverParent,
			targetEl,
			notePath: pathFor("2026-04-13"),
		});

		expect(request).toBeNull();
	});

	it("AC-CAL-03.7: previews the missing note's own path and writes nothing", () => {
		const ports = makePorts();
		const notePath = pathFor("2026-04-13");

		const request = planHoverPreview({
			event: makeClick({ metaKey: true }),
			hoverParent,
			targetEl,
			notePath,
		});

		expect(request?.linktext).toBe(notePath);
		expect(ports.vault.contentAt(notePath)).toBeUndefined();
		expect(ports.vault.createdFolders).toEqual([]);
	});
});
