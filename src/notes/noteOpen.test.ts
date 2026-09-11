import { describe, it, expect } from "vitest";
import { isSplitModifierPressed, openNote, openNoteIn, openNoteInNewTab } from "./noteOpen";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";

const FILE = { path: "journal/daily/2026-04-13.md" };

function makeClick(overrides: Partial<MouseEvent> = {}): MouseEvent {
	return { metaKey: false, ctrlKey: false, ...overrides } as MouseEvent;
}

function macWorkspace(): FakeWorkspacePort {
	const workspace = new FakeWorkspacePort();
	workspace.isMacOS = true;
	return workspace;
}

describe("isSplitModifierPressed (AC-NOTE-06.2)", () => {
	it("is true for Cmd on macOS", () => {
		expect(isSplitModifierPressed(makeClick({ metaKey: true }), true)).toBe(true);
	});

	it("is false for Ctrl on macOS, where Ctrl+click is the context-menu gesture", () => {
		expect(isSplitModifierPressed(makeClick({ ctrlKey: true }), true)).toBe(false);
	});

	it("is true for Ctrl off macOS", () => {
		expect(isSplitModifierPressed(makeClick({ ctrlKey: true }), false)).toBe(true);
	});

	it("is false for Cmd off macOS", () => {
		expect(isSplitModifierPressed(makeClick({ metaKey: true }), false)).toBe(false);
	});

	it("is false for a plain click on either platform", () => {
		expect(isSplitModifierPressed(makeClick(), true)).toBe(false);
		expect(isSplitModifierPressed(makeClick(), false)).toBe(false);
	});
});

describe("openNote", () => {
	it("AC-NOTE-06.1: reuses the current unpinned tab on a plain click", async () => {
		const workspace = new FakeWorkspacePort();

		await openNote(FILE, makeClick(), workspace);

		expect(workspace.opened).toEqual([{ file: FILE, mode: "reuse" }]);
	});

	it("AC-NOTE-06.2: opens a split on a Cmd click on macOS", async () => {
		const workspace = macWorkspace();

		await openNote(FILE, makeClick({ metaKey: true }), workspace);

		expect(workspace.opened).toEqual([{ file: FILE, mode: "split" }]);
	});

	it("AC-NOTE-06.2: opens a split on a Ctrl click off macOS", async () => {
		const workspace = new FakeWorkspacePort();

		await openNote(FILE, makeClick({ ctrlKey: true }), workspace);

		expect(workspace.opened).toEqual([{ file: FILE, mode: "split" }]);
	});

	it("AC-NOTE-06.1: reuses the current tab on a Ctrl click on macOS", async () => {
		const workspace = macWorkspace();

		await openNote(FILE, makeClick({ ctrlKey: true }), workspace);

		expect(workspace.opened).toEqual([{ file: FILE, mode: "reuse" }]);
	});
});

describe("openNoteInNewTab", () => {
	it("AC-NOTE-06.3: opens a new tab instead of reusing the active one", async () => {
		const workspace = new FakeWorkspacePort();

		await openNoteInNewTab(FILE, workspace);

		expect(workspace.opened).toEqual([{ file: FILE, mode: "tab" }]);
	});
});

describe("openNoteIn", () => {
	it.each(["reuse", "split", "tab"] as const)("opens the note in the %s destination", async (mode) => {
		const workspace = new FakeWorkspacePort();

		await openNoteIn(FILE, mode, workspace);

		expect(workspace.opened).toEqual([{ file: FILE, mode }]);
	});
});

describe("opening a file that vanished (AC-NOTE-06.4)", () => {
	it("AC-NOTE-06.4: reports that the file no longer exists at the resolved path", async () => {
		const workspace = new FakeWorkspacePort();
		workspace.markMissing(FILE.path);

		await openNoteIn(FILE, "reuse", workspace);

		expect(workspace.notices).toEqual([
			`Could not open "${FILE.path}" — the file no longer exists at that path.`,
		]);
	});

	it("AC-NOTE-06.4: opens nothing in its place", async () => {
		const workspace = new FakeWorkspacePort();
		workspace.markMissing(FILE.path);

		await openNoteIn(FILE, "split", workspace);

		expect(workspace.opened).toEqual([]);
	});

	it("AC-NOTE-06.4: reports through the same path for a click and for the startup tab", async () => {
		const workspace = new FakeWorkspacePort();
		workspace.markMissing(FILE.path);

		await openNote(FILE, makeClick(), workspace);
		await openNoteInNewTab(FILE, workspace);

		expect(workspace.notices).toHaveLength(2);
		expect(workspace.opened).toEqual([]);
	});

	it("stays quiet when the file opens", async () => {
		const workspace = new FakeWorkspacePort();

		await openNoteIn(FILE, "tab", workspace);

		expect(workspace.notices).toEqual([]);
	});
});

describe("the path a note was found at (AC-NOTE-06.4)", () => {
	it("defaults to the file's own path", async () => {
		const workspace = new FakeWorkspacePort();

		await openNoteIn(FILE, "reuse", workspace);

		expect(workspace.foundPaths).toEqual([FILE.path]);
	});

	it("is carried by the click and the startup routes alike", async () => {
		const workspace = new FakeWorkspacePort();

		await openNote(FILE, makeClick(), workspace);
		await openNoteInNewTab(FILE, workspace);

		expect(workspace.foundPaths).toEqual([FILE.path, FILE.path]);
	});

	it("can be given explicitly, so a caller that knows where it looked keeps that path", async () => {
		const workspace = new FakeWorkspacePort();
		const moved = { path: "archive/2026-04-13.md" };

		await openNoteIn(moved, "reuse", workspace, FILE.path);

		expect(workspace.foundPaths).toEqual([FILE.path]);
	});

	it("AC-NOTE-06.4: names the path that was tried, not the one a move rewrote on the handle", async () => {
		const workspace = new FakeWorkspacePort();
		const handle = { path: FILE.path };
		workspace.markMissing(FILE.path);
		// A move rewrites path on the same object, so the notice must not read it back.
		workspace.onOpen = () => {
			handle.path = "archive/2026-04-13.md";
		};

		await openNoteIn(handle, "reuse", workspace);

		expect(workspace.notices).toEqual([
			`Could not open "${FILE.path}" — the file no longer exists at that path.`,
		]);
	});
});
