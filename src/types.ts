import type { Moment } from "moment";

/** Quarter is reserved (DEC-23): the type names it, no release-1 behavior uses it. */
export type Granularity = "day" | "week" | "month" | "quarter" | "year";

export interface PeriodicConfig {
	enabled: boolean;
	format: string;
	folder: string;
	templatePath: string;
	/** Match a filename that starts with the formatted date but carries extra text after it. */
	allowPrefixMatch: boolean;
	openAtStartup: boolean;
}

export const DEFAULT_PERIODIC_CONFIG: PeriodicConfig = {
	enabled: false,
	format: "",
	folder: "",
	templatePath: "",
	allowPrefixMatch: false,
	openAtStartup: false,
};

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
