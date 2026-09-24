import type { Moment } from "moment";
import type { ICalendarMonth, PeriodicConfig } from "../types";
import { computeNotePath } from "../notes/noteUtils";
import { getWeekAnchor } from "./calendarUtils";
import type { CalendarDeps } from "../adapters/calendarDeps";

/** Words per filled segment of the word-count dot, until a setting carries one. */
export const DEFAULT_WORDS_PER_SEGMENT = 250;

/** How many of the word-count dot's segments there are to fill. */
export const WORD_DOT_SEGMENTS = 5;

/**
 * Segments of the word-count dot a note of `words` words fills: one per
 * `threshold` words, never fewer than one for a note with any word in it and
 * never more than five. A threshold that is not a positive whole number is
 * ignored in favour of the default (AC-CAL-07.3).
 */
export function wordCountSegments(words: number, threshold: number): number {
	if (words <= 0) return 0;
	const perSegment = Number.isInteger(threshold) && threshold > 0 ? threshold : DEFAULT_WORDS_PER_SEGMENT;
	return Math.min(WORD_DOT_SEGMENTS, Math.max(1, Math.floor(words / perSegment)));
}

/**
 * Words in a note's content: runs of letters or digits in any script, an
 * inner apostrophe kept ("it's" is one word). The frontmatter block is left
 * out, since a template writes it and the user does not.
 */
export function countWords(content: string): number {
	const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
	return body.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

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
	 * Word count of each note in `paths`, read through the vault port. A path
	 * whose note is gone or cannot be read is left out, so its cell draws no
	 * word-count dot rather than a wrong one.
	 */
	async getWordCounts(paths: Iterable<string>): Promise<Map<string, number>> {
		const counts = new Map<string, number>();
		await Promise.all(
			[...new Set(paths)].map(async (path) => {
				const file = this.deps.vault.getFile(path);
				if (!file) return;
				try {
					counts.set(path, countWords(await this.deps.vault.readFile(file)));
				} catch {
					// ponytail: an unreadable note just shows no word-count dot
				}
			}),
		);
		return counts;
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
