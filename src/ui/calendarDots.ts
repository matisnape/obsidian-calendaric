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
 * existing periodic notes, and watches the vault so dots update live. Only word
 * counts are kept between renders, per path.
 *
 * Every vault question here goes through the injected ports (AC-ARCH-11.2), so
 * the scanner runs against fakes with no Obsidian in the process.
 */
export class DotScanner {
	private unsubscribe: () => void;
	/**
	 * Word count per note path, so a routine render reads no unchanged note
	 * again. The read itself is kept, so an edit's redraw check and the render
	 * it triggers share one read. `undefined` for a note that could not be read.
	 */
	private wordCounts = new Map<string, Promise<number | undefined>>();
	/** Bumped on every vault change, so a read that a change overtook is not kept. */
	private changes = 0;
	/**
	 * Word count each note's dot was last drawn from, so an edit redraws only a
	 * dot it changes. `undefined` while that render is still reading the note.
	 */
	private shown = new Map<string, number | undefined>();

	constructor(private deps: CalendarDeps, onUpdate: () => void) {
		this.unsubscribe = deps.vault.onChange((change) => {
			// Every change kind may mean new content at the path, so its count is
			// read again on the next render.
			this.changes++;
			this.wordCounts.delete(change.file.path);
			if (change.oldPath !== undefined) this.wordCounts.delete(change.oldPath);
			// Create, delete and rename can move any dot. A metadata change is how
			// the host reports a saved edit, and its parse of a file it already
			// reported as created; neither moves a note-exists dot, so only a
			// shown note's word-count dot can change.
			if (change.kind !== "metadata") return onUpdate();
			if (this.shown.has(change.file.path)) void this.redrawIfWordDotMoved(change.file.path, onUpdate);
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
	 * word-count dot rather than a wrong one. A count is kept until the vault
	 * reports a change at its path.
	 */
	async getWordCounts(paths: Iterable<string>): Promise<Map<string, number>> {
		const counts = new Map<string, number>();
		const shown = new Map<string, number | undefined>([...paths].map((path) => [path, undefined]));
		this.shown = shown;
		await Promise.all(
			[...shown.keys()].map(async (path) => {
				const words = await this.readWordCount(path);
				if (words !== undefined) counts.set(path, words);
			}),
		);
		// A later render has replaced `shown` meanwhile; it records its own.
		if (this.shown === shown) for (const path of shown.keys()) shown.set(path, counts.get(path) ?? 0);
		return counts;
	}

	/**
	 * Re-read one shown note after an edit and redraw the grid only when its
	 * word-count dot fills a different number of segments. The host reports
	 * every autosave, so a redraw per report would rebuild the grid every few
	 * seconds while the user types in today's note.
	 */
	private async redrawIfWordDotMoved(path: string, onUpdate: () => void): Promise<void> {
		const drawn = this.shown.get(path);
		// Still being read by the render that shows it: its count is unknown.
		if (drawn === undefined) return onUpdate();
		const words = (await this.readWordCount(path)) ?? 0;
		// ponytail: threshold is the default until a setting carries one, as in the widget
		if (wordCountSegments(words, DEFAULT_WORDS_PER_SEGMENT) !== wordCountSegments(drawn, DEFAULT_WORDS_PER_SEGMENT)) {
			onUpdate();
		}
	}

	/** One note's word count, from the kept read or a new one; `undefined` when unreadable. */
	private readWordCount(path: string): Promise<number | undefined> {
		const kept = this.wordCounts.get(path);
		if (kept) return kept;
		const file = this.deps.vault.getFile(path);
		if (!file) return Promise.resolve(undefined);
		const changesBefore = this.changes;
		const read: Promise<number | undefined> = this.deps.vault.readFile(file).then(countWords, () => {
			// ponytail: an unreadable note shows no word-count dot, and is tried again next render
			if (this.wordCounts.get(path) === read) this.wordCounts.delete(path);
			return undefined;
		});
		// A change after this point drops the kept read in the change handler.
		if (this.changes === changesBefore) this.wordCounts.set(path, read);
		return read;
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
