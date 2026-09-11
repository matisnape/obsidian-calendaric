import { describe, it, expect } from "vitest";
import { CALENDAR_OPEN_FAILED, calendarViewCommand, openCalendarView } from "./calendarCommand";
import { FakeCalendarLeafPort } from "../adapters/fakeCalendarLeafPort";

function setup(): { leaves: FakeCalendarLeafPort; notices: string[] } {
	return { leaves: new FakeCalendarLeafPort(), notices: [] };
}

describe("openCalendarView", () => {
	it("creates a calendar leaf and reveals it when none is open", async () => {
		const { leaves, notices } = setup();

		await openCalendarView(leaves, (m) => notices.push(m));

		expect(leaves.leafCount).toBe(1);
		expect(leaves.revealCount).toBe(1);
		expect(notices).toEqual([]);
	});

	it("reveals the existing leaf instead of creating a second one", async () => {
		const { leaves, notices } = setup();
		leaves.leafCount = 1;

		await openCalendarView(leaves, (m) => notices.push(m));

		expect(leaves.leafCount).toBe(1);
		expect(leaves.revealCount).toBe(1);
		expect(notices).toEqual([]);
	});

	it("expands the sidebar holding a collapsed calendar leaf", async () => {
		const { leaves, notices } = setup();
		leaves.leafCount = 1;
		leaves.collapsed = true;

		await openCalendarView(leaves, (m) => notices.push(m));

		expect(leaves.collapsed).toBe(false);
		expect(leaves.leafCount).toBe(1);
		expect(notices).toEqual([]);
	});

	it("notices the failure and leaves no partial leaf when creation fails", async () => {
		const { leaves, notices } = setup();
		leaves.createFails = true;

		await openCalendarView(leaves, (m) => notices.push(m));

		expect(leaves.leafCount).toBe(0);
		expect(notices).toEqual([CALENDAR_OPEN_FAILED]);
	});

	it("notices the failure and leaves no partial leaf when the new leaf cannot be revealed", async () => {
		const { leaves, notices } = setup();
		leaves.revealFails = true;

		await openCalendarView(leaves, (m) => notices.push(m));

		expect(leaves.leafCount).toBe(0);
		expect(notices).toEqual([CALENDAR_OPEN_FAILED]);
	});

	it("keeps a pre-existing leaf when revealing it fails", async () => {
		const { leaves, notices } = setup();
		leaves.leafCount = 1;
		leaves.revealFails = true;

		await openCalendarView(leaves, (m) => notices.push(m));

		expect(leaves.leafCount).toBe(1);
		expect(notices).toEqual([CALENDAR_OPEN_FAILED]);
	});
});

describe("calendarViewCommand", () => {
	it("is listed when no calendar leaf is open", () => {
		const { leaves, notices } = setup();
		const command = calendarViewCommand(leaves, (m) => notices.push(m));

		expect(command.checkCallback?.(true)).toBe(true);
	});

	it("is not listed while a calendar leaf is visible", () => {
		const { leaves, notices } = setup();
		leaves.leafCount = 1;
		const command = calendarViewCommand(leaves, (m) => notices.push(m));

		expect(command.checkCallback?.(true)).toBe(false);
	});

	it("is listed when the leaf exists but its sidebar is collapsed", () => {
		const { leaves, notices } = setup();
		leaves.leafCount = 1;
		leaves.collapsed = true;
		const command = calendarViewCommand(leaves, (m) => notices.push(m));

		expect(command.checkCallback?.(true)).toBe(true);
	});

	it("opens nothing while the palette is only checking", () => {
		const { leaves, notices } = setup();
		const command = calendarViewCommand(leaves, (m) => notices.push(m));

		command.checkCallback?.(true);

		expect(leaves.leafCount).toBe(0);
		expect(leaves.revealCount).toBe(0);
	});

	it("opens the calendar view when invoked for real", async () => {
		const { leaves, notices } = setup();
		const command = calendarViewCommand(leaves, (m) => notices.push(m));

		command.checkCallback?.(false);
		await Promise.resolve();

		expect(leaves.leafCount).toBe(1);
		expect(leaves.revealCount).toBe(1);
	});
});
