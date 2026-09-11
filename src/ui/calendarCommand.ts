import type { Command } from "obsidian";
import type { CalendarLeafHandle, CalendarLeafPort } from "../adapters/calendarLeafPort";

export const CALENDAR_COMMAND_ID = "show-calendar-view";
export const CALENDAR_OPEN_FAILED = "Calendaric: the calendar view could not be opened.";

export type Notify = (message: string) => void;

/**
 * Coordinates every calendar-leaf creation in the plugin.
 *
 * Two separate guarantees, so two separate locks:
 *
 * - One in-flight creation. Startup and the palette command both reach for the
 *   leaf, and each reads the workspace before it creates, so without a shared
 *   lock they can both find nothing and each make one.
 * - One in-flight open. Two palette invocations share a single reveal rather
 *   than revealing once per caller.
 *
 * One coordinator per plugin instance; a second instance would defeat both.
 */
export interface CalendarCoordinator {
	/** Create the leaf if none exists, without revealing or focusing it. */
	readonly ensure: () => Promise<void>;
	/**
	 * Create the leaf if needed, then reveal it and give it focus.
	 *
	 * Declared as a property rather than a method so callers can pass it on
	 * without binding: it closes over the coordinator's locks, not over `this`.
	 */
	readonly open: () => Promise<void>;
}

export function createCalendarCoordinator(leaves: CalendarLeafPort, notify: Notify): CalendarCoordinator {
	let creating: Promise<CalendarLeafHandle> | null = null;
	let opening: Promise<void> | null = null;

	/**
	 * The shared creation, plus whether this caller is the one that started it.
	 * Only the starter may roll the leaf back, so a failed reveal in one caller
	 * never removes a leaf another caller is already using.
	 */
	function share(): { creation: Promise<CalendarLeafHandle>; started: boolean } {
		if (creating) return { creation: creating, started: false };

		const creation = leaves.create();
		creating = creation;
		const clear = () => {
			creating = null;
		};
		// Both arms, so a failed creation does not wedge every later attempt,
		// and attaching a rejection handler here keeps the shared promise from
		// counting as unhandled.
		creation.then(clear, clear);
		return { creation, started: true };
	}

	async function openOnce(): Promise<void> {
		const existing = leaves.find();
		let mine: CalendarLeafHandle | null = null;
		try {
			let leaf = existing;
			if (!leaf) {
				const { creation, started } = share();
				leaf = await creation;
				if (started) mine = leaf;
			}
			await leaf.reveal();
			leaf.focus();
		} catch {
			mine?.detach();
			notify(CALENDAR_OPEN_FAILED);
		}
	}

	return {
		ensure: async () => {
			if (leaves.find()) return;
			try {
				await share().creation;
			} catch {
				// Startup is not a user action, so it reports nothing; the
				// adapter has already removed whatever it half-built.
			}
		},

		open: () => {
			if (!opening) {
				opening = openOnce().finally(() => {
					opening = null;
				});
			}
			return opening;
		},
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
