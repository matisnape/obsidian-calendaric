import type { Moment } from "moment";
import type { WeekStartOption } from "../settings";
import type { ICalendarDay, ICalendarMonth } from "../types";

/**
 * Convert a WeekStartOption to a numeric weekday (0=Sun, 1=Mon, ..., 6=Sat).
 */
export function resolveWeekStart(option: WeekStartOption): number {
	if (option === "locale") {
		return window.moment.localeData().firstDayOfWeek();
	}
	const map: Record<string, number> = {
		sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
		thursday: 4, friday: 5, saturday: 6,
	};
	return map[option] ?? 1;
}

/**
 * Get short weekday headers (e.g. ["Mon", "Tue", ...]) starting from weekStart.
 */
export function getWeekdayHeaders(weekStart: number): string[] {
	const headers: string[] = [];
	for (let i = 0; i < 7; i++) {
		const dayIndex = (weekStart + i) % 7;
		// Use isoWeekday for 1-7 (Mon-Sun), but day() uses 0-6 (Sun-Sat)
		// We need to map 0=Sun,1=Mon,...,6=Sat to a moment day name
		headers.push(
			window.moment().day(dayIndex).format("ddd")
		);
	}
	return headers;
}

/**
 * Generate 6 weeks × 7 days grid for the given month.
 * @param displayedMonth - any moment in the month to display
 * @param weekStart - numeric weekday (0=Sun ... 6=Sat)
 */
export function getMonthGrid(
	displayedMonth: Moment,
	weekStart: number
): ICalendarMonth {
	const today = window.moment().startOf("day");
	const startOfMonth = displayedMonth.clone().startOf("month");
	const displayedMonthIndex = startOfMonth.month();

	// Find the first day of the grid (the weekStart day on or before the 1st)
	let gridStart = startOfMonth.clone();
	while (gridStart.day() !== weekStart) {
		gridStart.subtract(1, "day");
	}

	const weeks: ICalendarMonth = [];
	const cursor = gridStart.clone();

	for (let w = 0; w < 6; w++) {
		const days: ICalendarDay[] = [];
		for (let d = 0; d < 7; d++) {
			const dayOfWeek = cursor.day(); // 0=Sun, 6=Sat
			days.push({
				date: cursor.clone(),
				isToday: cursor.isSame(today, "day"),
				isAdjacentMonth: cursor.month() !== displayedMonthIndex,
				isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
			});
			cursor.add(1, "day");
		}
		weeks.push({
			weekNumber: days[0]!.date.isoWeek(),
			days,
		});
	}

	return weeks;
}
