import type { App, EventRef } from "obsidian";
import type { Moment } from "moment";
import type { ICalendarMonth, PeriodicConfig } from "../types";
import { computeNotePath } from "../notes/noteUtils";
import { getWeekAnchor } from "./calendarUtils";
import { ObsidianVaultConfigAdapter } from "../adapters/obsidianVaultConfigAdapter";
import type { VaultConfigPort } from "../adapters/vaultConfigPort";

/**
 * Scans vault files to determine which days/weeks in the visible month have
 * existing periodic notes, and registers vault event listeners so dots update
 * live without a separate cache.
 */
export class DotScanner {
	private app: App;
	private vaultConfig: VaultConfigPort;
	private eventRefs: EventRef[] = [];

	constructor(app: App, onUpdate: () => void) {
		this.app = app;
		this.vaultConfig = new ObsidianVaultConfigAdapter(app);

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
			const path = computeNotePath(cursor, config, this.vaultConfig);
			if (this.app.vault.getAbstractFileByPath(path)) {
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
			const path = computeNotePath(getWeekAnchor(week.days), config, this.vaultConfig);
			if (this.app.vault.getAbstractFileByPath(path)) {
				paths.add(path);
			}
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
