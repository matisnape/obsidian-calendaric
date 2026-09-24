import type { WorkspacePort } from "../adapters/workspacePort";
import { openNoteIn } from "../notes/noteOpen";
import type { JumpDirection, PeriodicNoteIndex } from "../notes/periodicNoteIndex";
import type { ReleaseGranularity } from "../types";
import { ADJECTIVE } from "./granularityCommands";

export type JumpIndex = Pick<PeriodicNoteIndex, "granularityOf" | "closestTo">;

/**
 * Open the closest existing note either side of the one in the active pane, or
 * say there is none. Nothing here can create a note: the index only knows
 * files that already exist (AC-CMD-06.1–06.3).
 *
 * `activePath` is the note the active pane holds. A jump counts from it, not
 * from today, and does nothing when it is not a note of `granularity` — the
 * palette hides the command then (AC-CMD-06.4), but a hotkey can still fire.
 */
export async function jumpToClosestNote(
	granularity: ReleaseGranularity,
	direction: JumpDirection,
	activePath: string | null,
	index: JumpIndex | null,
	workspace: WorkspacePort,
): Promise<void> {
	if (activePath === null || !index || index.granularityOf(activePath) !== granularity) return;

	const target = index.closestTo(activePath, direction);
	if (!target) {
		workspace.showNotice(`No ${direction === "forward" ? "next" : "previous"} ${ADJECTIVE[granularity]} note.`);
		return;
	}

	await openNoteIn(target, "reuse", workspace, target.path);
}
