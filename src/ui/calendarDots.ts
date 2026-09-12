import type { Moment } from "moment";
import type { ICalendarMonth, PeriodicConfig } from "../types";
import { computeNotePath } from "../notes/noteUtils";
import { getWeekAnchor } from "./calendarUtils";
import type { CalendarDeps } from "../adapters/calendarDeps";

/**
 * Scans vault files to determine which days/weeks in the visible month have
 * existing periodic notes, and watches the vault so dots update live without a
 * separate cache.
 *
 * Every vault question here goes through the injected ports (AC-ARCH-11.2), so
 * the scanner runs against fakes with no Obsidian in the process.
 */
export class DotScanner {
	private unsubscribe: () => void;

	constructor(private deps: CalendarDeps, onUpdate: () => void) {
		this.unsubscribe = deps.vault.onChange((change) => {
			// A metadata change is the host finishing its parse of a file it has
			// already reported as created, so it moves no dot. Create, delete and
			// rename are the three that do — the same three this scanner watched
			// before the port carried them.
			if (change.kind === "metadata") return;
			onUpdate();
		});
	}

	/**
	 * Returns the set of vault paths that correspond to daily notes in the
	 * displayed month. A day cell shows a dot if its computed path is in this set.
	 */
	getDayNotePaths(month: Moment, config: PeriodicConfig): Set<string> {
		const paths = new Set<string>();
		if (!config.enabled || !config.format) return paths;

		// Iterate every day of the month
		const start = month.clone().startOf("month");
		const end = month.clone().endOf("month");
		const cursor = start.clone();

		while (cursor.isSameOrBefore(end, "day")) {
			const path = computeNotePath(cursor, config, this.deps.vaultConfig);
			if (this.deps.vault.pathExists(path)) {
				paths.add(path);
			}
			cursor.add(1, "day");
		}

		return paths;
	}

	/**
	 * Returns the set of vault paths that correspond to weekly notes for the
	 * rows of the given grid.
	 *
	 * Takes the grid rather than the month so the scan cannot disagree with what
	 * was drawn: `getWeekAnchor` is the same date the week number came from, and
	 * the row set is the same six rows.
	 */
	getWeekNotePaths(grid: ICalendarMonth, config: PeriodicConfig): Set<string> {
		const paths = new Set<string>();
		if (!config.enabled || !config.format) return paths;

		for (const week of grid) {
			const path = computeNotePath(getWeekAnchor(week.days), config, this.deps.vaultConfig);
			if (this.deps.vault.pathExists(path)) {
				paths.add(path);
			}
		}

		return paths;
	}

	/**
	 * Stop watching the vault. Call when the calendar view closes.
	 */
	destroy(): void {
		this.unsubscribe();
		// A second destroy() is a no-op, the way clearing the ref list was.
		this.unsubscribe = () => undefined;
	}
}
