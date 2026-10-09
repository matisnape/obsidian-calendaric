import type { CellGranularity } from "./types";
import type { Moment } from "./granularity/registry";

/**
 * The version of the `CalendarIndicator` interface. It goes up with any change
 * an existing indicator would have to adapt to, and `apiVersion` below is typed
 * as this literal, so an indicator written against an older version fails to
 * compile with "Type '1' is not assignable to type '2'" on that member, and the
 * calendar refuses to draw one that reaches it uncompiled (AC-ARCH-05.3).
 */
export const INDICATOR_API_VERSION = 1;

/** One calendar cell an indicator may draw into. */
export interface IndicatorCell {
	/** What the cell stands for: a day, or a week row's number. */
	readonly granularity: CellGranularity;
	/** The cell's date; for a week row, the row's own first day (`getWeekAnchor`). */
	readonly date: Moment;
	/** The vault path of the cell's periodic note, whether or not it exists. */
	readonly path: string;
	/** Whether that note exists, as the calendar's own scan found it. */
	readonly noteExists: boolean;
	/** The cell's indicator row. An indicator appends its marks here, after earlier indicators' marks. */
	readonly container: HTMLElement;
}

/** What the calendar shares with every indicator for one render. */
export interface IndicatorContext {
	/**
	 * Word count of each existing note in `paths`, read once per render and kept
	 * until the vault reports a change. Call it once per render with every path,
	 * since each call replaces the set of notes whose edits redraw the grid.
	 */
	getWordCounts(paths: Iterable<string>): Promise<Map<string, number>>;
}

/** A mark the calendar draws in its cells, such as the note dot. */
export interface CalendarIndicator {
	/** The interface version this indicator was written against; must equal `INDICATOR_API_VERSION`. */
	readonly apiVersion: typeof INDICATOR_API_VERSION;
	/** A stable name, used when the calendar reports a problem with this indicator. */
	readonly id: string;
	/**
	 * Draw into every cell of one render. Called once per render with all cells,
	 * in registration order. May finish asynchronously: a render that lands
	 * first has already detached these containers, so a late mark shows nothing.
	 */
	draw(cells: readonly IndicatorCell[], context: IndicatorContext): void | Promise<void>;
}
