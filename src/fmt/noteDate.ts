import type { Moment } from "moment";

export type Granularity = "day" | "week" | "month" | "year";

export function computeNoteDate(date: Moment, granularity: Granularity = "day"): string {
	const periodStart = date.clone().startOf(granularity);
	return `${granularity}:${periodStart.valueOf()}`;
}
