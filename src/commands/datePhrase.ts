import { ALL_GRANULARITIES, isReleaseGranularity, RELEASE_GRANULARITIES } from "../types";
import { releaseFacts } from "../granularity/registry";
import type { ReleaseGranularity } from "../types";

/** The date type, read off the clock Obsidian provides rather than imported (see main.ts). */
type Moment = ReturnType<typeof window.moment>;

/** The natural-language date plugin's parser: the moment a phrase names, or null when it names none. */
export type ParseDate = (phrase: string) => Date | null;

export interface PeriodSuggestion {
	granularity: ReleaseGranularity;
	date: Moment;
	label: string;
}

interface Shortcut {
	label: string;
	granularity: ReleaseGranularity;
}

const RELATIVE = ["This", "Last", "Next"] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * What an empty query offers, in registry order: a granularity's own names for
 * the periods around today when it has them (Today, Yesterday, Tomorrow), else
 * This, Last and Next of its unit. Quarter is reserved (DEC-23) and not in the
 * release set, so it gets no shortcut.
 */
const DEFAULT_SHORTCUTS: readonly Shortcut[] = RELEASE_GRANULARITIES.flatMap((granularity) => {
	const { nearNames, unitName } = releaseFacts(granularity);
	const labels = nearNames
		? [nearNames[0], nearNames[-1], nearNames[1]].filter((label): label is string => label !== undefined)
		: RELATIVE.map((word) => `${word} ${unitName}`);
	return labels.map((label) => ({ label, granularity }));
});

// RELEASE_GRANULARITIES[0] is the day: the registry lists the finest first, and
// the tuple type carries that, so the compiler sees "day" here.

/** Offered once something is typed, so an empty query is not a list of twenty-one weekdays. */
const WEEKDAY_SHORTCUTS: readonly Shortcut[] = RELATIVE.flatMap((word) =>
	WEEKDAYS.map((day): Shortcut => ({ label: `${word} ${day}`, granularity: RELEASE_GRANULARITIES[0] })),
);

function wordsOf(phrase: string): string[] {
	return phrase.trim().toLowerCase().split(/\s+/).map((word) => word.replace(/s$/, ""));
}

/** Whether a phrase names a reserved granularity (quarter, DEC-23), which has no note to open. */
export function namesReservedUnit(phrase: string): boolean {
	const words = wordsOf(phrase);
	return ALL_GRANULARITIES.some((granularity) => !isReleaseGranularity(granularity) && words.includes(granularity));
}

/** null for a reserved unit, rather than the day the parser's date falls in. */
function granularityOf(phrase: string): ReleaseGranularity | null {
	if (namesReservedUnit(phrase)) return null;
	const words = wordsOf(phrase);
	return RELEASE_GRANULARITIES.find((granularity) => words.includes(releaseFacts(granularity).unitName)) ?? RELEASE_GRANULARITIES[0];
}

/**
 * The periods a typed phrase can mean.
 *
 * A query that starts a shortcut ("last m" -> Last month, Last Monday) offers
 * those shortcuts, so a phrase can be picked before it is finished. Anything
 * else goes to the parser whole, and a period word in it picks the
 * granularity. Every date comes from `parse`: the shortcuts only supply
 * phrases. Granularities not in `active` are never offered, and an empty
 * result means the phrase names no date.
 */
export function suggestPeriods(
	query: string,
	parse: ParseDate,
	active: readonly ReleaseGranularity[],
): PeriodSuggestion[] {
	const typed = query.trim().toLowerCase();
	const pool = typed === "" ? DEFAULT_SHORTCUTS : [...DEFAULT_SHORTCUTS, ...WEEKDAY_SHORTCUTS];
	const shortcuts = pool.filter(({ label }) => label.toLowerCase().startsWith(typed));
	const named = granularityOf(typed);
	const candidates = shortcuts.length > 0 ? shortcuts : named ? [{ label: query.trim(), granularity: named }] : [];

	const found: PeriodSuggestion[] = [];
	for (const { label, granularity } of candidates) {
		if (!active.includes(granularity)) continue;
		const date = parse(label);
		if (date) found.push({ granularity, date: window.moment(date), label });
	}
	return found;
}
