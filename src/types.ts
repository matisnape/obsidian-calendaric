import type { Moment } from "moment";

/** Every granularity, in the order the UI and the commands use. */
export const ALL_GRANULARITIES = ["day", "week", "month", "quarter", "year"] as const;

/** Quarter is reserved (DEC-23): the type names it, no release-1 behavior uses it. */
export type Granularity = (typeof ALL_GRANULARITIES)[number];

/**
 * The granularities the first release actually creates notes for (DEC-23).
 *
 * Narrower than `Granularity` on purpose. `Granularity` is what configuration
 * round-trips, quarter included, so a reserved value survives a save it was
 * never meant to act on. This list is what behaviour is allowed to act on, and
 * the gap between the two is why the check has to run at runtime: the type
 * cannot refuse a value it is required to carry.
 */
export const RELEASE_GRANULARITIES = ["day", "week", "month", "year"] as const;

export type ReleaseGranularity = (typeof RELEASE_GRANULARITIES)[number];

/** The granularities a calendar cell stands for: the release set minus year. */
export type CellGranularity = Exclude<ReleaseGranularity, "year">;

/** Narrows a configured granularity to the set this release creates notes for. */
export function isReleaseGranularity(granularity: Granularity): granularity is ReleaseGranularity {
	return (RELEASE_GRANULARITIES as readonly Granularity[]).includes(granularity);
}

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
