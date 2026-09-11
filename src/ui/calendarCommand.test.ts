import { describe, it, expect } from "vitest";
import {
	CALENDAR_COMMAND_ID,
	CALENDAR_OPEN_FAILED,
	calendarViewCommand,
	createCalendarCoordinator,
} from "./calendarCommand";
import { FakeCalendarLeafPort } from "../adapters/fakeCalendarLeafPort";

function setup(): { leaves: FakeCalendarLeafPort; notices: string[] } {
	return { leaves: new FakeCalendarLeafPort(), notices: [] };
}

describe("CalendarCoordinator.open", () => {
	it("AC-CMD-01.1: creates a calendar leaf, reveals it and focuses it when none is open", async () => {
		const { leaves, notices } = setup();

		await createCalendarCoordinator(leaves, (m) => notices.push(m)).open();

		expect(leaves.created).toHaveLength(1);
		expect(leaves.find()?.isVisible()).toBe(true);
		expect(leaves.find()?.revealCount).toBe(1);
		expect(leaves.find()?.focusCount).toBe(1);
		expect(notices).toEqual([]);
	});

	it("AC-CMD-01.3: reveals the existing leaf instead of creating a second one", async () => {
		const { leaves, notices } = setup();
		const existing = leaves.withExistingLeaf({ visible: true });

		await createCalendarCoordinator(leaves, (m) => notices.push(m)).open();

		expect(leaves.created).toEqual([]);
		expect(existing.revealCount).toBe(1);
		expect(existing.focusCount).toBe(1);
		expect(notices).toEqual([]);
	});

	it("AC-CMD-01.4: reveals a leaf hidden in a collapsed sidebar", async () => {
		const { leaves, notices } = setup();
		const existing = leaves.withExistingLeaf({ visible: false });

		await createCalendarCoordinator(leaves, (m) => notices.push(m)).open();

		expect(leaves.created).toEqual([]);
		expect(existing.isVisible()).toBe(true);
		expect(existing.focusCount).toBe(1);
		expect(notices).toEqual([]);
	});

	it("AC-CMD-01.5: notices the failure and leaves no leaf behind when creation fails", async () => {
		const { leaves, notices } = setup();
		leaves.createFails = true;

		await createCalendarCoordinator(leaves, (m) => notices.push(m)).open();

		expect(leaves.created).toEqual([]);
		expect(leaves.find()).toBeNull();
		expect(notices).toEqual([CALENDAR_OPEN_FAILED]);
	});

	it("AC-CMD-01.5: detaches the leaf it just created when revealing it fails", async () => {
		const { leaves, notices } = setup();
		// Arm the failure on whatever create() hands back.
		const port = leaves;
		const create = port.create.bind(port);
		port.create = async (options: { active: boolean }) => {
			const leaf = await create(options);
			leaf.revealFails = true;
			return leaf;
		};

		await createCalendarCoordinator(port, (m) => notices.push(m)).open();

		expect(port.created).toHaveLength(1);
		expect(port.created[0]?.detached).toBe(true);
		expect(port.find()).toBeNull();
		expect(notices).toEqual([CALENDAR_OPEN_FAILED]);
	});

	it("AC-CMD-01.5: keeps a pre-existing leaf when revealing it fails", async () => {
		const { leaves, notices } = setup();
		const existing = leaves.withExistingLeaf({ visible: false });
		existing.revealFails = true;

		await createCalendarCoordinator(leaves, (m) => notices.push(m)).open();

		expect(existing.detached).toBe(false);
		expect(leaves.find()).toBe(existing);
		expect(notices).toEqual([CALENDAR_OPEN_FAILED]);
	});
});

describe("calendarViewCommand", () => {
	it("is named after the story and keeps the scaffold id so hotkeys survive", () => {
		const { leaves, notices } = setup();
		const command = calendarViewCommand(leaves, createCalendarCoordinator(leaves, (m) => notices.push(m)).open);

		expect(command.name).toBe("Open calendar");
		expect(command.id).toBe(CALENDAR_COMMAND_ID);
		expect(CALENDAR_COMMAND_ID).toBe("show-calendar-view");
	});

	it("AC-CMD-01.2: is listed when no calendar leaf is open", () => {
		const { leaves, notices } = setup();
		const command = calendarViewCommand(leaves, createCalendarCoordinator(leaves, (m) => notices.push(m)).open);

		expect(command.checkCallback?.(true)).toBe(true);
	});

	it("AC-CMD-01.2: is not listed while a calendar leaf is visible", () => {
		const { leaves, notices } = setup();
		leaves.withExistingLeaf({ visible: true });
		const command = calendarViewCommand(leaves, createCalendarCoordinator(leaves, (m) => notices.push(m)).open);

		expect(command.checkCallback?.(true)).toBe(false);
	});

	it("AC-CMD-01.2, AC-CMD-01.4: is listed when the leaf exists but is not on screen", () => {
		const { leaves, notices } = setup();
		leaves.withExistingLeaf({ visible: false });
		const command = calendarViewCommand(leaves, createCalendarCoordinator(leaves, (m) => notices.push(m)).open);

		expect(command.checkCallback?.(true)).toBe(true);
	});

	it("AC-CMD-01.2: opens nothing while the palette is only checking", () => {
		const { leaves, notices } = setup();
		const command = calendarViewCommand(leaves, createCalendarCoordinator(leaves, (m) => notices.push(m)).open);

		command.checkCallback?.(true);

		expect(leaves.created).toEqual([]);
		expect(leaves.find()).toBeNull();
	});

	it("AC-CMD-01.1: opens the calendar view when invoked for real", async () => {
		const { leaves, notices } = setup();
		const command = calendarViewCommand(leaves, createCalendarCoordinator(leaves, (m) => notices.push(m)).open);

		command.checkCallback?.(false);
		// checkCallback is synchronous by Obsidian's contract, so it drops the
		// promise; drain the queue before asserting on what it started.
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(leaves.created).toHaveLength(1);
		expect(leaves.find()?.revealCount).toBe(1);
		expect(leaves.find()?.focusCount).toBe(1);
	});
});

describe("CalendarCoordinator creation locking", () => {
	it("AC-CMD-01.3: creates one leaf when two callers race, because both see no leaf", async () => {
		const { leaves, notices } = setup();
		const release = leaves.deferCreation();
		const { open } = createCalendarCoordinator(leaves, (m) => notices.push(m));

		const first = open();
		const second = open();
		// Both calls are past their workspace read and neither can have
		// finished creating, which is the state that makes the race real.
		expect(leaves.created).toEqual([]);
		release();
		await Promise.all([first, second]);

		expect(leaves.created).toHaveLength(1);
		expect(notices).toEqual([]);
	});

	it("AC-CMD-01.3: reveals once for a race, rather than once per caller", async () => {
		const { leaves, notices } = setup();
		const release = leaves.deferCreation();
		const { open } = createCalendarCoordinator(leaves, (m) => notices.push(m));

		const calls = [open(), open(), open()];
		release();
		await Promise.all(calls);

		expect(leaves.find()?.revealCount).toBe(1);
		expect(leaves.find()?.focusCount).toBe(1);
	});

	it("AC-CMD-01.3: makes one leaf when startup and the command race", async () => {
		const { leaves, notices } = setup();
		const release = leaves.deferCreation();
		const coordinator = createCalendarCoordinator(leaves, (m) => notices.push(m));

		// initLeaf's path and the palette path, both in flight at once.
		const startup = coordinator.ensure();
		const command = coordinator.open();
		expect(leaves.created).toEqual([]);
		release();
		await Promise.all([startup, command]);

		expect(leaves.created).toHaveLength(1);
	});

	it("creates the startup leaf inactive, so launching Obsidian never steals focus", async () => {
		const { leaves, notices } = setup();
		const coordinator = createCalendarCoordinator(leaves, (m) => notices.push(m));

		await coordinator.ensure();

		expect(leaves.createdActive).toEqual([false]);
	});

	it("AC-CMD-01.1: creates the command's leaf active, because the user asked for it", async () => {
		const { leaves, notices } = setup();
		const coordinator = createCalendarCoordinator(leaves, (m) => notices.push(m));

		await coordinator.open();

		expect(leaves.createdActive).toEqual([true]);
	});

	it("does not reveal or focus the leaf that startup created", async () => {
		const { leaves, notices } = setup();
		const coordinator = createCalendarCoordinator(leaves, (m) => notices.push(m));

		await coordinator.ensure();

		expect(leaves.created).toHaveLength(1);
		expect(leaves.find()?.revealCount).toBe(0);
		expect(leaves.find()?.focusCount).toBe(0);
	});

	it("leaves startup silent when creation fails, because it is not a user action", async () => {
		const { leaves, notices } = setup();
		leaves.createFails = true;
		const coordinator = createCalendarCoordinator(leaves, (m) => notices.push(m));

		await coordinator.ensure();

		expect(leaves.find()).toBeNull();
		expect(notices).toEqual([]);
	});

	it("AC-CMD-01.3: creates nothing on startup when a leaf is already open", async () => {
		const { leaves, notices } = setup();
		leaves.withExistingLeaf({ visible: false });
		const coordinator = createCalendarCoordinator(leaves, (m) => notices.push(m));

		await coordinator.ensure();

		expect(leaves.created).toEqual([]);
	});

	it("AC-CMD-01.3: opens again after the first open has settled", async () => {
		const { leaves, notices } = setup();
		const { open } = createCalendarCoordinator(leaves, (m) => notices.push(m));

		await open();
		await open();

		// The second call finds the leaf the first made, so it reveals rather
		// than creating: one leaf, two reveals.
		expect(leaves.created).toHaveLength(1);
		expect(leaves.find()?.revealCount).toBe(2);
	});

	it("does not wedge after a failed open", async () => {
		const { leaves, notices } = setup();
		leaves.createFails = true;
		const { open } = createCalendarCoordinator(leaves, (m) => notices.push(m));

		await open();
		leaves.createFails = false;
		await open();

		expect(leaves.created).toHaveLength(1);
		expect(notices).toEqual([CALENDAR_OPEN_FAILED]);
	});
});
