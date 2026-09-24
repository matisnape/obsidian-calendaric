import type { JumpDirection, PeriodicNoteIndex } from "../notes/periodicNoteIndex";
import type { PeriodNotePorts } from "../notes/periodNoteOpen";
import { openOrCreatePeriodNote } from "../notes/periodNoteOpen";
import type { PeriodicConfig, ReleaseGranularity } from "../types";

export type NeighbourIndex = Pick<PeriodicNoteIndex, "granularityOf" | "dateOf" | "get">;

/**
 * Open the note of the period right after or before the active note's,
 * writing it first when the vault holds none (AC-CMD-07.1–07.3).
 *
 * Counts from the note in the active pane, never from today, and does nothing
 * when that pane holds no note of `granularity` — the palette hides the
 * command then (AC-CMD-07.4), but a hotkey can still fire.
 */
export async function openNeighbourNote(
	granularity: ReleaseGranularity,
	direction: JumpDirection,
	activePath: string | null,
	index: NeighbourIndex | null,
	config: PeriodicConfig,
	ports: PeriodNotePorts,
): Promise<void> {
	if (activePath === null || !index || index.granularityOf(activePath) !== granularity) return;

	const from = index.dateOf(activePath);
	if (!from) return;

	const date = from.clone().add(direction === "forward" ? 1 : -1, granularity);
	await openOrCreatePeriodNote(granularity, date, config, index.get(granularity, date), ports);
}
