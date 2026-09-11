import { describe, it, expect } from "vitest";
import {
	CALENDAR_COMMAND_ID,
	CALENDAR_OPEN_FAILED,
	calendarViewCommand,
	openCalendarView,
} from "./calendarCommand";
import { FakeCalendarLeafPort } from "../adapters/fakeCalendarLeafPort";

function setup(): { leaves: FakeCalendarLeafPort; notices: string[] } {
	return { leaves: new FakeCalendarLeafPort(), notices: [] };
}

describe("openCalendarView", () => {
	it("creates a calendar leaf, reveals it and focuses it when none is open", async () => {
		const { leaves, notices } = setup();

		await openCalendarView(leaves, (m) => notices.push(m));

		expect(leaves.created).toHaveLength(1);
		expect(leaves.find()?.isVisible()).toBe(true);
		expect(leaves.find()?.revealCount).toBe(1);
		expect(leaves.find()?.focusCount).toBe(1);
		expect(notices).toEqual([]);
	});

	it("reveals the existing leaf instead of creating a second one", async () => {
		const { leaves, notices } = setup();
		const existing = leaves.withExistingLeaf({ visible: true });

		await openCalendarView(leaves, (m) => notices.push(m));

		expect(leaves.created).toEqual([]);
		expect(existing.revealCount).toBe(1);
		expect(existing.focusCount).toBe(1);
		expect(notices).toEqual([]);
	});

	it("reveals a leaf hidden in a collapsed sidebar", async () => {
		const { leaves, notices } = setup();
		const existing = leaves.withExistingLeaf({ visible: false });

		await openCalendarView(leaves, (m) => notices.push(m));

		expect(leaves.created).toEqual([]);
		expect(existing.isVisible()).toBe(true);
		expect(existing.focusCount).toBe(1);
		expect(notices).toEqual([]);
	});

	it("notices the failure and leaves no leaf behind when creation fails", async () => {
		const { leaves, notices } = setup();
		leaves.createFails = true;

		await openCalendarView(leaves, (m) => notices.push(m));

		expect(leaves.created).toEqual([]);
		expect(leaves.find()).toBeNull();
		expect(notices).toEqual([CALENDAR_OPEN_FAILED]);
	});

	it("detaches the leaf it just created when revealing it fails", async () => {
		const { leaves, notices } = setup();
		// Arm the failure on whatever create() hands back.
		const port = leaves;
		const create = port.create.bind(port);
		port.create = async () => {
			const leaf = await create();
			leaf.revealFails = true;
			return leaf;
		};

		await openCalendarView(port, (m) => notices.push(m));

		expect(port.created).toHaveLength(1);
		expect(port.created[0]?.detached).toBe(true);
		expect(port.find()).toBeNull();
		expect(notices).toEqual([CALENDAR_OPEN_FAILED]);
	});

	it("keeps a pre-existing leaf when revealing it fails", async () => {
		const { leaves, notices } = setup();
		const existing = leaves.withExistingLeaf({ visible: false });
		existing.revealFails = true;

		await openCalendarView(leaves, (m) => notices.push(m));

		expect(existing.detached).toBe(false);
		expect(leaves.find()).toBe(existing);
		expect(notices).toEqual([CALENDAR_OPEN_FAILED]);
	});
});

describe("calendarViewCommand", () => {
	it("is named after the story and keeps the scaffold id so hotkeys survive", () => {
		const { leaves, notices } = setup();
		const command = calendarViewCommand(leaves, (m) => notices.push(m));

		expect(command.name).toBe("Open calendar");
		expect(command.id).toBe(CALENDAR_COMMAND_ID);
		expect(CALENDAR_COMMAND_ID).toBe("show-calendar-view");
	});

	it("is listed when no calendar leaf is open", () => {
		const { leaves, notices } = setup();
		const command = calendarViewCommand(leaves, (m) => notices.push(m));

		expect(command.checkCallback?.(true)).toBe(true);
	});

	it("is not listed while a calendar leaf is visible", () => {
		const { leaves, notices } = setup();
		leaves.withExistingLeaf({ visible: true });
		const command = calendarViewCommand(leaves, (m) => notices.push(m));

		expect(command.checkCallback?.(true)).toBe(false);
	});

	it("is listed when the leaf exists but is not on screen", () => {
		const { leaves, notices } = setup();
		leaves.withExistingLeaf({ visible: false });
		const command = calendarViewCommand(leaves, (m) => notices.push(m));

		expect(command.checkCallback?.(true)).toBe(true);
	});

	it("opens nothing while the palette is only checking", () => {
		const { leaves, notices } = setup();
		const command = calendarViewCommand(leaves, (m) => notices.push(m));

		command.checkCallback?.(true);

		expect(leaves.created).toEqual([]);
		expect(leaves.find()).toBeNull();
	});

	it("opens the calendar view when invoked for real", async () => {
		const { leaves, notices } = setup();
		const command = calendarViewCommand(leaves, (m) => notices.push(m));

		command.checkCallback?.(false);
		// checkCallback is synchronous by Obsidian's contract, so it drops the
		// promise; drain the queue before asserting on what it started.
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(leaves.created).toHaveLength(1);
		expect(leaves.find()?.revealCount).toBe(1);
		expect(leaves.find()?.focusCount).toBe(1);
	});
});
