import type { Moment } from "moment";
import type { Granularity } from "../types";

export function computeNoteDate(date: Moment, granularity: Granularity = "day"): string {
	// A weekly note's week is its ISO week, because that is the week noteUtils
	// writes onto disk: it formats GGGG/WW and resolves {{monday:..}} through
	// isoWeekday(1). moment's startOf("week") follows the active locale
	// instead, which under a Sunday-start locale gives the Sunday that ends an
	// ISO week its own anchor — that Sunday would then miss its own week's note
	// and take the identity of the previous week's note.
	const periodStart = date.clone().startOf(granularity === "week" ? "isoWeek" : granularity);
	return `${granularity}:${periodStart.valueOf()}`;
}
