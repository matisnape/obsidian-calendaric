import type { Moment } from "moment";

export interface PeriodicConfig {
	enabled: boolean;
	format: string;
	folder: string;
	templatePath: string;
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
