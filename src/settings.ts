export type WeekStartOption =
	| "locale"
	| "monday"
	| "tuesday"
	| "wednesday"
	| "thursday"
	| "friday"
	| "saturday"
	| "sunday";

export interface CalendaricSettings {
	weekStart: WeekStartOption;
	showWeekNumbers: boolean;
}

export const DEFAULT_SETTINGS: CalendaricSettings = {
	weekStart: "monday",
	showWeekNumbers: true,
};
