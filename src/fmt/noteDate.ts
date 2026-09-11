import type { Moment } from "moment";
import type { Granularity } from "../types";
import { weekSemantics } from "./parseFilename";

/**
 * The week a date belongs to is decided by the configured weekly format,
 * because the format is what gets written into the weekly note's filename: a
 * gggg/ww pair numbers locale weeks, a GGGG/WW pair numbers ISO weeks, and the
 * two put the same Sunday in different weeks. A format numbering no week keeps
 * the ISO anchor, which is the convention noteUtils already writes with
 * ({{monday:..}} resolves through isoWeekday(1)).
 */
function startUnit(granularity: Granularity, weekFormat: string): Granularity | "isoWeek" {
	if (granularity !== "week") return granularity;
	return weekSemantics(weekFormat) === "locale" ? "week" : "isoWeek";
}

export function computeNoteDate(
	date: Moment,
	granularity: Granularity = "day",
	weekFormat = "",
): string {
	const periodStart = date.clone().startOf(startUnit(granularity, weekFormat));
	return `${granularity}:${periodStart.valueOf()}`;
}
