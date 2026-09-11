import type { Command } from "obsidian";
import type { CalendarLeafHandle, CalendarLeafPort } from "../adapters/calendarLeafPort";

export const CALENDAR_COMMAND_ID = "show-calendar-view";
export const CALENDAR_OPEN_FAILED = "Calendaric: the calendar view could not be opened.";

export type Notify = (message: string) => void;

/**
 * Open the calendar view, reusing the leaf that is already there.
 *
 * A half-created leaf shows an empty pane the user cannot repair from the UI,
 * so a failed open is rolled back. Only the leaf this call created is rolled
 * back: losing the user's own calendar is worse than a failed reveal.
 */
export async function openCalendarView(leaves: CalendarLeafPort, notify: Notify): Promise<void> {
	const existing = leaves.find();
	let created: CalendarLeafHandle | null = null;
	try {
		// The assignment records what this call created, so the rollback below
		// can tell it apart from a leaf that was already open.
		const leaf = existing ?? (created = await leaves.create());
		await leaf.reveal();
		leaf.focus();
	} catch {
		created?.detach();
		notify(CALENDAR_OPEN_FAILED);
	}
}

/**
 * The palette command. It hides itself while the calendar is already on screen,
 * so the palette never offers a no-op, yet stays available whenever the leaf is
 * off screen — behind another tab, or inside a collapsed sidebar.
 */
export function calendarViewCommand(leaves: CalendarLeafPort, notify: Notify): Command {
	return {
		id: CALENDAR_COMMAND_ID,
		name: "Open calendar",
		checkCallback: (checking: boolean) => {
			if (leaves.find()?.isVisible() === true) return false;
			if (!checking) void openCalendarView(leaves, notify);
			return true;
		},
	};
}
