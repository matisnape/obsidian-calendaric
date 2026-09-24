import type { Moment } from "moment";
import type { Granularity } from "../types";
import { hasWeekdayWrapper, weekSemantics } from "./parseFilename";

/**
 * The week a date belongs to is decided by the configured weekly format,
 * because the format is what gets written into the weekly note's filename: a
 * gggg/ww pair numbers locale weeks, a GGGG/WW pair numbers ISO weeks, and the
 * two put the same Sunday in different weeks. A format naming its week only
 * through {{weekday:fmt}} follows the configured week, because noteUtils writes
 * each wrapper inside it (AC-FMT-03.2). A format numbering no week at all keeps
 * the ISO anchor.
 */
function startUnit(granularity: Granularity, weekFormat: string): Granularity | "isoWeek" {
	if (granularity !== "week") return granularity;
	const semantics = weekSemantics(weekFormat);
	if (semantics === "locale" || (semantics === null && hasWeekdayWrapper(weekFormat))) return "week";
	return "isoWeek";
}

export function computeNoteDate(
	date: Moment,
	granularity: Granularity = "day",
	weekFormat = "",
): string {
	const periodStart = date.clone().startOf(startUnit(granularity, weekFormat));
	return `${granularity}:${periodStart.valueOf()}`;
}
