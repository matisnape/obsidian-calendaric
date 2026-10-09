import type { Moment } from "moment";
import type { Granularity } from "../types";
import { granularityEntry } from "../granularity/registry";

function startUnit(granularity: Granularity, weekFormat: string) {
	return granularityEntry(granularity).startUnit?.(weekFormat) ?? granularity;
}

export function computeNoteDate(
	date: Moment,
	granularity: Granularity = "day",
	weekFormat = "",
): string {
	const periodStart = date.clone().startOf(startUnit(granularity, weekFormat));
	return `${granularity}:${periodStart.valueOf()}`;
}
