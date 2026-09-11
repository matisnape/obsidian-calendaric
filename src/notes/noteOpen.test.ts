import { describe, it, expect } from "vitest";
import { isMetaPressed, openNote, openNoteInNewTab } from "./noteOpen";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";

const FILE = { path: "journal/daily/2026-04-13.md" };

function makeClick(overrides: Partial<MouseEvent> = {}): MouseEvent {
	return { metaKey: false, ctrlKey: false, ...overrides } as MouseEvent;
}

describe("isMetaPressed", () => {
	it("is true when the meta key is pressed", () => {
		expect(isMetaPressed(makeClick({ metaKey: true }))).toBe(true);
	});

	it("is true when the ctrl key is pressed", () => {
		expect(isMetaPressed(makeClick({ ctrlKey: true }))).toBe(true);
	});

	it("is false for a plain click", () => {
		expect(isMetaPressed(makeClick())).toBe(false);
	});
});

describe("openNote", () => {
	it("reuses the current leaf on a plain click", async () => {
		const workspace = new FakeWorkspacePort();

		await openNote(FILE, makeClick(), workspace);

		expect(workspace.opened).toEqual([{ file: FILE, mode: "reuse" }]);
	});

	it("opens a split leaf on a meta/ctrl click", async () => {
		const workspace = new FakeWorkspacePort();

		await openNote(FILE, makeClick({ metaKey: true }), workspace);

		expect(workspace.opened).toEqual([{ file: FILE, mode: "split" }]);
	});
});

describe("openNoteInNewTab", () => {
	it("opens a new tab leaf", async () => {
		const workspace = new FakeWorkspacePort();

		await openNoteInNewTab(FILE, workspace);

		expect(workspace.opened).toEqual([{ file: FILE, mode: "tab" }]);
	});
});
