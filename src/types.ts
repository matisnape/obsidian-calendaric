import type { Moment } from "moment";

/** A single day in the calendar grid */
export interface ICalendarDay {
	date: Moment;
	isToday: boolean;
	isAdjacentMonth: boolean;
	isWeekend: boolean;
}

/** A single week row in the calendar grid */
export interface ICalendarWeek {
	weekNumber: number;
	days: ICalendarDay[];
}

/** The full month grid data */
export type ICalendarMonth = ICalendarWeek[];
