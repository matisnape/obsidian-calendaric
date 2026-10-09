import type { Command } from "obsidian";
import type { FileDateIdentity } from "../fmt/resolveFileDate";
import { granularityEntry } from "../granularity/registry";

export const REVEAL_ACTIVE_NOTE_COMMAND_ID = "reveal-active-note";
export const REVEAL_NEEDS_NOTE = '"Reveal active note" needs an open daily or weekly note.';

export interface RevealActiveNoteDeps {
	/** The note in the active pane, when that pane is a markdown editor. */
	activePath: () => string | null;
	resolve: (path: string) => FileDateIdentity | null;
	/** Creates the calendar leaf if needed, then reveals and focuses it. */
	open: () => Promise<void>;
	/** The loaded calendar view, or null when no leaf holds one. */
	view: () => { revealActiveNote(): void } | null;
	notify: (message: string) => void;
}

/**
 * Show the active day or week note's period in the calendar (AC-CMD-03.1), or
 * say why not, leaving the calendar alone (AC-CMD-03.2).
 *
 * The note is read before open(): opening focuses the calendar leaf, and from
 * then on the active pane is no longer the note's editor. The view still finds
 * the note because workspace.getActiveFile() falls back to the most recently
 * active file when the active view is not a FileView. open() runs even when
 * the calendar is on screen, because revealing is what loads a deferred view.
 */
export async function revealActiveNote(deps: RevealActiveNoteDeps): Promise<void> {
	const path = deps.activePath();
	const granularity = path === null ? null : deps.resolve(path)?.granularity;
	if (!granularity || !granularityEntry(granularity).cell?.reveal) {
		deps.notify(REVEAL_NEEDS_NOTE);
		return;
	}

	await deps.open();
	deps.view()?.revealActiveNote();
}

/** A plain callback, so the palette lists it whatever the active pane holds (AC-CMD-03.3). */
export function revealActiveNoteCommand(deps: RevealActiveNoteDeps): Command {
	return {
		id: REVEAL_ACTIVE_NOTE_COMMAND_ID,
		name: "Reveal active note",
		callback: () => {
			void revealActiveNote(deps);
		},
	};
}
