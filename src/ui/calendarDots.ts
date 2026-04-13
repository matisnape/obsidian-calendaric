import type { App, EventRef } from "obsidian";
import type { Moment } from "moment";
import type { PeriodicConfig } from "../types";
import { computeNotePath } from "../notes/noteUtils";

/**
 * Scans vault files to determine which days/weeks in the visible month have
 * existing periodic notes, and registers vault event listeners so dots update
 * live without a separate cache.
 */
export class DotScanner {
	private app: App;
	private eventRefs: EventRef[] = [];

	constructor(app: App, onUpdate: () => void) {
		this.app = app;

		this.eventRefs.push(app.vault.on("create", onUpdate));
		this.eventRefs.push(app.vault.on("delete", onUpdate));
		this.eventRefs.push(app.vault.on("rename", onUpdate));
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
			const path = computeNotePath(cursor, config, this.app);
			if (this.app.vault.getAbstractFileByPath(path)) {
				paths.add(path);
			}
			cursor.add(1, "day");
		}

		return paths;
	}

	/**
	 * Returns the set of vault paths that correspond to weekly notes whose ISO
	 * Monday falls within the same weeks shown in the displayed month.
	 * Week dot container is keyed by the ISO Monday date string.
	 */
	getWeekNotePaths(month: Moment, config: PeriodicConfig): Set<string> {
		const paths = new Set<string>();
		if (!config.enabled || !config.format) return paths;

		// Collect the ISO Mondays of all weeks visible in the month grid
		// (some may start in the previous or next month)
		const start = month.clone().startOf("month").startOf("isoWeek");
		const end = month.clone().endOf("month").endOf("isoWeek");
		const cursor = start.clone();

		while (cursor.isSameOrBefore(end, "day")) {
			const monday = cursor.clone().isoWeekday(1);
			const path = computeNotePath(monday, config, this.app);
			if (this.app.vault.getAbstractFileByPath(path)) {
				paths.add(path);
			}
			cursor.add(1, "week");
		}

		return paths;
	}

	/**
	 * Unregister all vault event listeners. Call when the calendar view closes.
	 */
	destroy(): void {
		for (const ref of this.eventRefs) {
			this.app.vault.offref(ref);
		}
		this.eventRefs = [];
	}
}
