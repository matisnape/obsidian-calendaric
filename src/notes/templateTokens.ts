import type { Moment, unitOfTime } from "moment";
import type { PeriodicConfig, ReleaseGranularity } from "../types";
import { formatWithWeekTokens, applyWeekTokens } from "./noteUtils";

/**
 * The units a `{{date±N<unit>}}` offset accepts, and the moment duration each
 * names. Case matters, as it does in a moment format string: `M` is a month and
 * `m` would be a minute.
 *
 * ponytail: date units only. A periodic note is a day or a week, so an
 * hour-or-finer offset has nothing to point at; add `h`/`m`/`s` here if a
 * granularity below a day ever arrives.
 */
const OFFSET_UNITS: Record<string, unitOfTime.DurationConstructor> = {
	y: "years",
	Q: "quarters",
	M: "months",
	w: "weeks",
	d: "days",
};

/**
 * `{{date+7d}}` and `{{date-1M:DD.MM}}` — a signed offset, a unit letter, and an
 * optional format.
 *
 * The unit letter is required by the pattern rather than validated after it, so
 * a malformed offset such as `{{date+7:DD.MM}}` never matches and survives into
 * the note exactly as the user typed it.
 *
 * The format group excludes `{` as well as `}`, so an unclosed `{{date+1d:DD`
 * cannot reach past itself and pair up with the closing braces of whatever token
 * comes next (AC-TPL-06.5). Left to cross `{`, it would format the text between
 * the two halves as a moment pattern and destroy both of them.
 */
const DATE_OFFSET_RE = /\{\{date([+-]\d+)([A-Za-z])(?::([^{}]+))?\}\}/g;

/**
 * Substitute all Calendaric template body variables in `content`.
 *
 * Universal:
 *   {{date}}           → note's configured format (with week tokens evaluated)
 *   {{date:fmt}}       → date with custom moment format
 *   {{date+7d}}        → date shifted by a signed offset, in the configured format
 *   {{date-1M:fmt}}    → the same, in a custom moment format
 *   {{time}}           → the wall clock at creation, HH:mm
 *   {{title}}          → the note's filename (without extension)
 *
 * Daily only:
 *   {{yesterday}}      → previous day in configured format
 *   {{tomorrow}}       → next day in configured format
 *
 * Weekly only:
 *   {{monday:fmt}} – {{sunday:fmt}}  → that weekday within the note's week
 *
 * Monthly and yearly notes carry neither group: there is no "yesterday" for a
 * month, and a year has no one Monday. They get the universal tokens only.
 *
 * `weekStart` is moment's `day()` numbering, 0=Sunday through 6=Saturday — what
 * `resolveWeekStart` hands out. It decides which seven days a weekday token is
 * allowed to reach into (DEC-01).
 *
 * ponytail: the default matches `DEFAULT_GLOBALS.weekStart` ("monday") in
 * settings/model.ts, so the callers that have no settings to hand keep the
 * shipped default instead of a second convention. Carrying the live setting
 * from the settings screen down to here is US-FMT-03, which owns the week-start
 * plumbing for every feature at once; drop the default when that lands.
 */
export function substituteTemplateTokens(
	content: string,
	date: Moment,
	granularity: ReleaseGranularity,
	config: PeriodicConfig,
	title: string,
	weekStart = 1,
): string {
	let out = content;

	// {{date±Nunit}} and {{date±Nunit:fmt}} — an offset from the note's own date.
	// An unknown unit letter is left as written for the same reason a missing one
	// is: the token was meant for someone, and deleting it loses what it said.
	out = out.replace(DATE_OFFSET_RE, (match, amount: string, unit: string, fmt?: string) => {
		const duration = OFFSET_UNITS[unit];
		if (duration === undefined) return match;

		const shifted = date.clone().add(Number(amount), duration);
		return fmt === undefined ? formatWithWeekTokens(config.format, shifted) : shifted.format(fmt);
	});

	// {{date:custom}} — must be replaced before {{date}} to avoid double-match.
	// The format excludes `{` for the reason DATE_OFFSET_RE does: an unclosed
	// `{{date:DD` must not borrow the next token's `}}` (AC-TPL-06.5).
	out = out.replace(/\{\{date:([^{}]+)\}\}/g, (_m, fmt: string) => date.format(fmt));

	// {{date}} — uses the granularity's configured format (with week tokens)
	const dateStr = formatWithWeekTokens(config.format, date);
	out = out.replace(/\{\{date\}\}/g, dateStr);

	// {{time}} — the clock, never the note's own date. A date the user clicked in
	// the calendar carries midnight, so reading the time off it would stamp 00:00
	// into every note that is not for right now.
	out = out.replace(/\{\{time\}\}/g, window.moment().format("HH:mm"));

	// {{title}}
	out = out.replace(/\{\{title\}\}/g, title);

	if (granularity === "day") {
		// These tokens exist to link to the adjacent notes, and computeNotePath() names
		// those files with formatWithWeekTokens(). Plain format() would diverge from it.
		const yesterday = formatWithWeekTokens(config.format, date.clone().subtract(1, "day"));
		const tomorrow = formatWithWeekTokens(config.format, date.clone().add(1, "day"));
		out = out.replace(/\{\{yesterday\}\}/g, yesterday);
		out = out.replace(/\{\{tomorrow\}\}/g, tomorrow);
	}

	if (granularity === "week") {
		// {{monday:fmt}} – {{sunday:fmt}} in template body
		out = applyWeekTokens(out, date, weekStart);
	}

	return out;
}
