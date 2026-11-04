import type { ReleaseGranularity } from "../types";
import { computeNoteDate } from "../fmt/noteDate";
import { weekdayWithin } from "../notes/noteUtils";

type Moment = ReturnType<typeof window.moment>;

export interface StripDay {
	date: Moment;
	/** The daily note's own day; never set for a longer period. */
	isNoteDay: boolean;
	isToday: boolean;
}

/**
 * The start of the period `date` falls in, read off the note identity itself
 * (`granularity:<epoch ms>`), so a week starts wherever the index says it does.
 */
export function periodStart(date: Moment, granularity: ReleaseGranularity, weekFormat: string): Moment {
	return window.moment(Number(computeNoteDate(date, granularity, weekFormat).split(":")[1]));
}

/**
 * The seven days of the week holding the first day of a note's period, from
 * `weekStart` (moment's `day()` numbering).
 */
export function stripDays(
	granularity: ReleaseGranularity,
	date: Moment,
	weekFormat: string,
	weekStart: number,
	now: Moment,
): StripDay[] {
	const start = periodStart(date, granularity, weekFormat);
	// Only a one-day period has a day of its own: the next day already starts another period.
	const oneDay = !periodStart(start.clone().add(1, "day"), granularity, weekFormat).isSame(start);
	const first = weekdayWithin(start, weekStart, weekStart);

	return Array.from({ length: 7 }, (_, i) => {
		const day = first.clone().add(i, "day");
		return {
			date: day,
			isNoteDay: oneDay && day.isSame(start, "day"),
			isToday: day.isSame(now, "day"),
		};
	});
}
