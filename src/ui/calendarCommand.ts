import type { Command } from "obsidian";
import type { CalendarLeafPort } from "../adapters/calendarLeafPort";

export const CALENDAR_OPEN_FAILED = "Calendaric: the calendar view could not be opened.";

export type Notify = (message: string) => void;

/**
 * Open the calendar view, reusing the leaf that is already there.
 *
 * A half-created leaf shows an empty pane the user cannot repair from the UI,
 * so a failed creation is rolled back. A leaf that predates the call is never
 * discarded, because losing the user's calendar is worse than a failed reveal.
 */
export async function openCalendarView(leaves: CalendarLeafPort, notify: Notify): Promise<void> {
	const existed = leaves.hasLeaf();
	try {
		if (!existed) await leaves.create();
		await leaves.reveal();
	} catch {
		if (!existed) leaves.discard();
		notify(CALENDAR_OPEN_FAILED);
	}
}

/**
 * The palette command. It hides itself while the calendar is already on screen,
 * so the palette never offers a no-op, yet stays available when the leaf exists
 * inside a collapsed sidebar and the user cannot see it.
 */
export function calendarViewCommand(leaves: CalendarLeafPort, notify: Notify): Command {
	return {
		id: "show-calendar-view",
		name: "Show calendar",
		checkCallback: (checking: boolean) => {
			if (leaves.isVisible()) return false;
			if (!checking) void openCalendarView(leaves, notify);
			return true;
		},
	};
}
