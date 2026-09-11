import type { Moment } from "moment";
import type { Granularity } from "../types";

export function computeNoteDate(date: Moment, granularity: Granularity = "day"): string {
	const periodStart = date.clone().startOf(granularity);
	return `${granularity}:${periodStart.valueOf()}`;
}
