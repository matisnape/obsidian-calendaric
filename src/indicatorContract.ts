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

export interface IndicatorCell {
	/** What the cell stands for. The calendar draws day cells and week-number cells today. */
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

export interface IndicatorContext {
	/**
	 * Word count of the note of every cell whose note exists, read once per
	 * render by the calendar. A note that cannot be read has no entry.
	 */
	readonly wordCounts: Promise<ReadonlyMap<string, number>>;
}

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
