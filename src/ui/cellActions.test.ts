import { describe, it, expect } from "vitest";
import moment from "moment";
import type { Moment } from "moment";
import type { HoverParent } from "obsidian";
import {
	HOVER_LINK_SOURCE,
	hoverPreviewRequest,
	openOrCreateNote,
	type CellClick,
	type CellPorts,
	type CreateRequest,
} from "./cellActions";
import { getMonthGrid } from "./calendarUtils";
import { computeNotePath } from "../notes/noteUtils";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import type { FoldState, NoteFile, VaultPort } from "../adapters/vaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import type { PeriodicConfig } from "../types";

const dayConfig: PeriodicConfig = {
	enabled: true,
	format: "YYYY-MM-DD",
	folder: "Daily",
	templatePath: "",
	allowPrefixMatch: false,
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

/** The same ports, on a Mac: there Cmd splits and Ctrl opens the context menu. */
function makeMacPorts(existingPaths: string[] = []): Ports {
	const ports = makePorts(existingPaths);
	ports.workspace.isMacOS = true;
	return ports;
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

/**
 * A vault that races the way the real one does.
 *
 * Every write parks until the test releases it, and the park happens *before*
 * the folder is registered — so a second activation looks while the folder is
 * still missing, which is the window the first race fix left open. Obsidian
 * rejects a folder that already exists, so this fake does too; without that,
 * the race cannot be reproduced at all.
 */
class RacingVault extends FakeVaultPort {
	createFolderCalls: string[] = [];
	/** How many of the next note writes must fail. */
	failWrites = 0;
	private open = false;
	private parked: (() => void)[] = [];

	override async createFolder(path: string): Promise<void> {
		this.createFolderCalls.push(path);
		await this.park();
		if (this.pathExists(path)) throw new Error(`Folder already exists: ${path}`);
		await super.createFolder(path);
	}

	override async createFile(path: string, content: string): Promise<NoteFile> {
		await this.park();
		if (this.failWrites > 0) {
			this.failWrites -= 1;
			throw new Error("vault is read-only");
		}
		return super.createFile(path, content);
	}

	/** Lets every parked write through, and every later one straight past. */
	release(): void {
		this.open = true;
		for (const resume of this.parked.splice(0)) resume();
	}

	private async park(): Promise<void> {
		if (this.open) return;
		await new Promise<void>((resolve) => this.parked.push(resolve));
	}
}

/**
 * One calendar pane's port over a vault another pane is also holding.
 *
 * Every pane builds its own adapter, so this is the realistic shape: two
 * distinct port objects, one vault behind them.
 */
class PortOverSharedVault implements VaultPort {
	constructor(private shared: FakeVaultPort) {}

	get backingVault(): object {
		return this.shared.backingVault;
	}

	folderExists(path: string): boolean {
		return this.shared.folderExists(path);
	}

	pathExists(path: string): boolean {
		return this.shared.pathExists(path);
	}

	getFile(path: string): NoteFile | null {
		return this.shared.getFile(path);
	}

	createFolder(path: string): Promise<void> {
		return this.shared.createFolder(path);
	}

	createFile(path: string, content: string): Promise<NoteFile> {
		return this.shared.createFile(path, content);
	}

	readFile(file: NoteFile): Promise<string> {
		return this.shared.readFile(file);
	}

	getTemplateFile(templatePath: string): NoteFile | null {
		return this.shared.getTemplateFile(templatePath);
	}

	readFoldState(file: NoteFile): FoldState | null {
		return this.shared.readFoldState(file);
	}

	applyFoldState(file: NoteFile, foldState: FoldState): Promise<void> {
		return this.shared.applyFoldState(file, foldState);
	}
}

/**
 * Indexes a grid whose length the compiler cannot know. A missing cell fails the
 * test naming the index, instead of throwing on a property of undefined.
 */
function at<T>(items: readonly T[], index: number): T {
	const item = items[index];
	if (item === undefined) throw new Error(`no grid element at index ${index}`);
	return item;
}

/** Drains every pending microtask, so parked activations reach their awaits. */
function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A plain click on `DAY`, on a Mac, with creation unconfirmed — override one field per test. */
function clickDay(ports: CellPorts, overrides: Partial<CellClick> = {}): Promise<void> {
	return openOrCreateNote({
		date: moment(DAY),
		granularity: "day",
		config: dayConfig,
		confirmBeforeCreate: false,
		event: makeClick(),
		ports,
		confirmCreate: stubConfirm(false).confirm,
		...overrides,
	});
}

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

	// The warning used to stop at a create path this file replaced, so it is
	// asserted on the path a user actually takes: a click.
	it("AC-NOTE-05.3: reports an unreadable template through the workspace, and still creates the note", async () => {
		const ports = makePorts();

		await clickDay(ports, { config: { ...dayConfig, templatePath: "Templates/missing.md" } });

		expect(ports.vault.contentAt(pathFor(DAY))).toBe("");
		expect(ports.workspace.notices).toEqual([
			"Calendaric could not read the template: Templates/missing.md",
		]);
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
		expect(confirm.asked.map((request) => request.body).join("\n")).toContain(
			moment(DAY).format("LL"),
		);
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
		const ports = makeMacPorts([path]);

		await clickDay(ports, { event: makeClick({ metaKey: true }) });

		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "split" }]);
	});

	it("AC-CAL-03.4: a Ctrl-click on a Mac opens in the active pane, not a split", async () => {
		const path = pathFor(DAY);
		const ports = makeMacPorts([path]);

		await clickDay(ports, { event: makeClick({ ctrlKey: true }) });

		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "reuse" }]);
	});

	it("AC-CAL-03.4: a Ctrl-click off macOS opens the existing note in a split", async () => {
		const path = pathFor(DAY);
		const ports = makePorts([path]);

		await clickDay(ports, { event: makeClick({ ctrlKey: true }) });

		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "split" }]);
	});

	it("AC-CAL-03.4: a Cmd-click off macOS opens in the active pane, not a split", async () => {
		const path = pathFor(DAY);
		const ports = makePorts([path]);

		await clickDay(ports, { event: makeClick({ metaKey: true }) });

		expect(ports.workspace.opened).toEqual([{ file: { path }, mode: "reuse" }]);
	});

	it("AC-CAL-03.4: a Cmd-click off macOS still creates the missing note", async () => {
		const ports = makePorts();

		await clickDay(ports, { event: makeClick({ metaKey: true }) });

		expect(ports.vault.contentAt(pathFor(DAY))).toBe("");
		expect(ports.workspace.opened).toEqual([{ file: { path: pathFor(DAY) }, mode: "reuse" }]);
	});

	it("AC-CAL-03.4: a modifier click creates the missing note first, then splits", async () => {
		const ports = makeMacPorts();

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
		// The last row of an April 2026 grid is May 4-10, so its first cell is a
		// trailing adjacent-month day. Asserted below rather than assumed.
		const trailing = at(at(grid, grid.length - 1).days, 0);
		const ports = makePorts();

		await clickDay(ports, { date: trailing.date });

		expect(trailing.isAdjacentMonth).toBe(true);
		expect(trailing.date.month()).toBe(4);
		expect(ports.workspace.opened).toEqual([
			{ file: { path: `Daily/${trailing.date.format("YYYY-MM-DD")}.md` }, mode: "reuse" },
		]);
	});

	it("AC-CAL-03.6: leaves the clicked cell's own date untouched, so the grid keeps its month", async () => {
		const grid = getMonthGrid(moment("2026-04-15"), 1, WEEK_FORMAT);
		const leading: Moment = at(at(grid, 0).days, 0).date;
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

	it("AC-CAL-03.2: one click creates while the other waits, even mid folder creation", async () => {
		const vault = new RacingVault();
		const ports: Ports = {
			vault,
			vaultConfig: new FakeVaultConfigPort(),
			workspace: new FakeWorkspacePort(),
		};

		const both = Promise.all([clickDay(ports), clickDay(ports)]);
		// The first click is parked inside the folder creation, so the second one
		// looks while neither the folder nor the note exists. Only one creation
		// may have started.
		await flushMicrotasks();
		expect(vault.createFolderCalls).toEqual(["Daily"]);

		vault.release();
		await both;

		const expected = { file: { path: pathFor(DAY) }, mode: "reuse" };
		expect(ports.workspace.opened).toEqual([expected, expected]);
		expect(vault.contentAt(pathFor(DAY))).toBe("");
	});

	it("AC-CAL-03.2: two calendar panes on one vault take turns, not each their own", async () => {
		const shared = new RacingVault();
		const paneOne = {
			vault: new PortOverSharedVault(shared),
			vaultConfig: new FakeVaultConfigPort(),
			workspace: new FakeWorkspacePort(),
		};
		const paneTwo = {
			vault: new PortOverSharedVault(shared),
			vaultConfig: new FakeVaultConfigPort(),
			workspace: new FakeWorkspacePort(),
		};

		const both = Promise.all([clickDay(paneOne), clickDay(paneTwo)]);
		await flushMicrotasks();
		expect(shared.createFolderCalls).toEqual(["Daily"]);

		shared.release();
		await both;

		const expected = { file: { path: pathFor(DAY) }, mode: "reuse" };
		expect(paneOne.workspace.opened).toEqual([expected]);
		expect(paneTwo.workspace.opened).toEqual([expected]);
		expect(shared.contentAt(pathFor(DAY))).toBe("");
	});

	it("AC-CAL-03.2: two clicks on different days each get their own note", async () => {
		const vault = new RacingVault();
		const ports: Ports = {
			vault,
			vaultConfig: new FakeVaultConfigPort(),
			workspace: new FakeWorkspacePort(),
		};

		const both = Promise.all([
			clickDay(ports, { date: moment(DAY) }),
			clickDay(ports, { date: moment("2026-04-14") }),
		]);
		await flushMicrotasks();
		vault.release();
		await both;

		expect(vault.contentAt(pathFor(DAY))).toBe("");
		expect(vault.contentAt(pathFor("2026-04-14"))).toBe("");
	});

	it("AC-CAL-03.2: a failed write does not block the next click on that folder", async () => {
		const vault = new RacingVault();
		vault.failWrites = 1;
		const ports: Ports = {
			vault,
			vaultConfig: new FakeVaultConfigPort(),
			workspace: new FakeWorkspacePort(),
		};

		// The second click queues behind the first, which is about to fail: its
		// turn must still come.
		const first = clickDay(ports).catch((error: unknown) => error);
		const second = clickDay(ports);
		await flushMicrotasks();
		vault.release();

		expect(await first).toEqual(new Error("vault is read-only"));
		await second;
		expect(vault.contentAt(pathFor(DAY))).toBe("");
		expect(ports.workspace.opened).toEqual([{ file: { path: pathFor(DAY) }, mode: "reuse" }]);
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
		const event = makeClick({ metaKey: true });

		const request = hoverPreviewRequest({ event, hoverParent, targetEl, notePath });

		// The hovered event is handed on as it came, so Page preview reads the
		// modifier the user actually held.
		expect(request).toEqual({
			event,
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
