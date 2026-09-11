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
 * An open function that survives being called twice at once.
 *
 * openCalendarView reads the workspace and then awaits creation, so two callers
 * arriving in that window would both see no leaf and each make one. They share
 * the first open instead. One opener per plugin instance: the whole point is
 * that every caller in the plugin goes through the same in-flight promise.
 */
export function createCalendarOpener(leaves: CalendarLeafPort, notify: Notify): () => Promise<void> {
	let inFlight: Promise<void> | null = null;

	return () => {
		if (!inFlight) {
			inFlight = openCalendarView(leaves, notify).finally(() => {
				// Clear it even when the open failed, so one failure does not
				// wedge the command for the rest of the session.
				inFlight = null;
			});
		}
		return inFlight;
	};
}

/**
 * The palette command. It hides itself while the calendar is already on screen,
 * so the palette never offers a no-op, yet stays available whenever the leaf is
 * off screen — behind another tab, or inside a collapsed sidebar.
 */
export function calendarViewCommand(leaves: CalendarLeafPort, open: () => Promise<void>): Command {
	return {
		id: CALENDAR_COMMAND_ID,
		name: "Open calendar",
		checkCallback: (checking: boolean) => {
			if (leaves.find()?.isVisible() === true) return false;
			if (!checking) void open();
			return true;
		},
	};
}
