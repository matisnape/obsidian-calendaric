import { day } from "./day";
import { week } from "./week";
import { month } from "./month";
import { quarter } from "./quarter";
import { year } from "./year";

/**
 * The one list of granularities. Adding a granularity is one new module in this
 * folder and one entry here; every other module reads what it needs to know
 * about a granularity off its entry (US-ARCH-05).
 *
 * The order is the order the UI and the commands use, and the order
 * `resolveFileDate` tries them in: narrowest period first.
 *
 * Nothing a granularity module imports may import this file or `src/types.ts`
 * at runtime: the bundle evaluates a module cycle in one order, and a module
 * that is still evaluating has not assigned its constants yet.
 */
export const GRANULARITY_REGISTRY = [day, week, month, quarter, year] as const;

/** Read off `window.moment` rather than imported: the bundle carries no moment of its own. */
export type Moment = ReturnType<typeof window.moment>;
type RelativeTimeKey = Parameters<ReturnType<Moment["localeData"]>["relativeTime"]>[2];
type StartOf = Parameters<Moment["startOf"]>[0];

export interface ReleaseFacts {
	/** The period's name in a label: "This week", "Last month". */
	readonly unitName: string;
	/** moment's relative-time key, so a count reads the way the locale writes it. */
	readonly countKey: RelativeTimeKey;
	/**
	 * The format a frontmatter date for this period is read against. Deliberately
	 * not the configured format: a frontmatter date is what a template or a script
	 * writes to say "this file is that period's note" when the filename cannot say
	 * it, so it has to be readable without knowing how this vault names its files.
	 */
	readonly frontmatterFormat: string;
	/** Names for the periods next to now, keyed by offset, used instead of "Last/This/Next <unit>". */
	readonly nearNames?: { readonly [offset: number]: string };
	/** The date a frontmatter date files the note under; the parsed date itself when absent. */
	readonly frontmatterDate?: (date: Moment) => Moment;
}

export interface RevealRow {
	/** The calendar's first weekday, moment's `day()` numbering. */
	readonly weekStart: number;
	/** Whether `date` falls in the note being revealed. */
	readonly sameNote: (date: Moment) => boolean;
}

export interface CellFacts {
	/** The period as a person reads it back, in a create prompt: "The week of 9 February 2026". */
	readonly subject: (date: Moment) => string;
	/**
	 * The first and last day of the grid cell showing the note dated `date`.
	 * Present only for the cells the active note highlights and the reveal
	 * command moves to: a day and a week row.
	 */
	readonly reveal?: (date: Moment, row: RevealRow) => [Moment, Moment];
}

export interface TemplateContext {
	readonly date: Moment;
	/** moment's `day()` numbering of the week a weekday token reaches into. */
	readonly weekStart: number;
}

export interface GranularityEntry {
	/** The stored key, the command-id prefix and the note identity's prefix. Never renamed. */
	readonly id: string;
	/** The settings heading: "Daily Notes". */
	readonly label: string;
	/** "daily": the palette, the create prompt and the settings description. */
	readonly adjective: string;
	/** The filename format used while the configured one is empty. */
	readonly defaultFormat: string;
	readonly defaultEnabled: boolean;
	/** Present when the first release acts on this granularity; quarter has none (DEC-23). */
	readonly release?: ReleaseFacts;
	/** Present when the calendar draws a cell for it. */
	readonly cell?: CellFacts;
	/** Present when the settings screen edits this granularity today. */
	readonly settings?: {
		/** A filename that starts with this granularity's date and then carries extra text. */
		readonly prefixMatchExample: string;
	};
	/** The moment unit a period starts on; the id itself when absent. */
	readonly startUnit?: (weekFormat: string) => StartOf;
	/**
	 * The names of the template tokens that link to the previous and the next
	 * note of this period, as in {{yesterday}} and {{tomorrow}}. `templateTokens.ts`
	 * substitutes them, since it is the one module that resolves those tokens.
	 */
	readonly neighbourTokens?: { readonly previous: string; readonly next: string };
	/** Substitutes the template tokens only this granularity has; none when absent. */
	readonly templateTokens?: (content: string, context: TemplateContext) => string;
}

type Registry = typeof GRANULARITY_REGISTRY;
type Entry = Registry[number];

/** Every id, in registry order. */
export type GranularityIds = IdsOf<Registry>;

type IdsOf<T extends readonly unknown[]> = { readonly [K in keyof T]: T[K] extends { id: infer I } ? I : never };

type ReleaseOf<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Rest]
	? Head extends { release: object; id: infer I }
		? [I, ...ReleaseOf<Rest>]
		: ReleaseOf<Rest>
	: [];

/** The ids whose entry carries release facts, in registry order. */
export type ReleaseIds = Readonly<ReleaseOf<Registry>>;

type GranularityId = Entry["id"];
type ReleaseId = ReleaseIds[number];

export type CellId = Extract<Entry, { cell: object }>["id"];

export type SettingsId = Extract<Entry, { settings: object }>["id"];

export const GRANULARITY = (() => {
	const byId: Record<string, Entry> = {};
	for (const entry of GRANULARITY_REGISTRY) byId[entry.id] = entry;
	return byId as { readonly [G in GranularityId]: Extract<Entry, { id: G }> };
})();

/** A granularity's entry, for the facts only some entries carry. */
export function granularityEntry(id: GranularityId): GranularityEntry {
	return GRANULARITY[id];
}

export function releaseFacts(id: ReleaseId): ReleaseFacts {
	return GRANULARITY[id].release;
}

export function cellFacts(id: CellId): CellFacts {
	return GRANULARITY[id].cell;
}

/** One value per id, built from that id's entry, keyed in the order `ids` gives. */
export function byGranularity<K extends GranularityId, V>(ids: readonly K[], value: (id: K) => V): Record<K, V> {
	const record = {} as Record<K, V>;
	for (const id of ids) record[id] = value(id);
	return record;
}
