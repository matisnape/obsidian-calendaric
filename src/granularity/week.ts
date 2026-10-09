import type { GranularityEntry, Moment, RevealRow } from "./registry";
import { hasWeekdayWrapper, weekSemantics } from "../fmt/parseFilename";
import { applyWeekTokens } from "../notes/noteUtils";

/**
 * The week a date belongs to is decided by the configured weekly format,
 * because the format is what gets written into the weekly note's filename: a
 * gggg/ww pair numbers locale weeks, a GGGG/WW pair numbers ISO weeks, and the
 * two put the same Sunday in different weeks. A format naming its week only
 * through {{weekday:fmt}} follows the configured week, because noteUtils writes
 * each wrapper inside it (AC-FMT-03.2). A format numbering no week at all keeps
 * the ISO anchor.
 */
function startUnit(weekFormat: string): "week" | "isoWeek" {
	const semantics = weekSemantics(weekFormat);
	if (semantics === "locale" || (semantics === null && hasWeekdayWrapper(weekFormat))) return "week";
	return "isoWeek";
}

/**
 * The Monday inside the week `date` starts, which is that week's identity
 * whatever numbering named it.
 *
 * The default frontmatter week format numbers locale weeks, and a locale week
 * can start on a Sunday — a day that belongs to the previous ISO week. Left
 * alone it would file the note one week early. `parseFilename` walks the same
 * step for a locale-numbered filename, so the two agree on which week is which.
 */
function mondayWithin(date: Moment): Moment {
	return date.clone().add((1 - date.isoWeekday() + 7) % 7, "days");
}

/**
 * The grid row that draws this week note: it starts on the one day of the
 * note's week that falls on the configured week start (see getWeekAnchor).
 */
function rowOf(date: Moment, row: RevealRow): [Moment, Moment] {
	let first = date;
	for (let offset = -6; offset <= 6; offset++) {
		const candidate = date.clone().add(offset, "day");
		if (candidate.day() === row.weekStart && row.sameNote(candidate)) {
			first = candidate;
			break;
		}
	}
	return [first, first.clone().add(6, "day")];
}

export const week = {
	id: "week",
	label: "Weekly Notes",
	adjective: "weekly",
	defaultFormat: "gggg-[W]ww",
	defaultEnabled: true,
	release: { unitName: "week", countKey: "ww", frontmatterFormat: "gggg-[W]ww", frontmatterDate: mondayWithin },
	cell: {
		subject: (date) => `The week of ${date.format("LL")}`,
		reveal: rowOf,
	},
	settings: { prefixMatchExample: "2026-W07, 09.02 - 15.02" },
	startUnit,
	/** {{monday:fmt}} – {{sunday:fmt}}: that weekday within the note's week. */
	templateTokens: (content, { date, weekStart }) => applyWeekTokens(content, date, weekStart),
} as const satisfies GranularityEntry;
