import type { Moment } from "moment";
import { formatWithWeekTokens } from "../notes/noteUtils";

export interface ParseFilenameResult {
	date: Moment;
	prefixMatch: boolean;
}

type FieldKind =
	| "year"
	| "isoWeekYear"
	| "localeWeekYear"
	| "monthNum"
	| "monthName"
	| "monthNameShort"
	| "day"
	| "isoWeek"
	| "localeWeek"
	| "weekdayFull"
	| "weekdayShort"
	| "weekdayMin"
	| "weekdayNum";

interface TokenGroup {
	kind: FieldKind;
	// True for any field nested inside {{weekday:fmt}} — it describes that
	// wrapper's own day, not the format's own date, so it never feeds
	// top-level date construction. AC-FMT-04.5 also exempts a nested
	// month/day field from matchOne's re-render comparison when a
	// week-number token decides the date; every other field (nested or not)
	// is still compared exactly.
	nested?: boolean;
}

interface Tokenized {
	pattern: string;
	groups: TokenGroup[];
}

const MONTHS = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = WEEKDAYS.map((d) => d.slice(0, 3));
const WEEKDAYS_MIN = WEEKDAYS.map((d) => d.slice(0, 2));

const TOKEN_CHARS = new Set(["Y", "G", "g", "M", "D", "W", "w", "d"]);

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function altRegex(names: string[]): string {
	return names.map(escapeRegex).join("|");
}

function tokenForRun(run: string): { regex: string; kind: FieldKind } | null {
	switch (run) {
		case "YYYY": return { regex: "\\d{4}", kind: "year" };
		// GGGG/WW are ISO week tokens (Monday-start); gggg/ww are locale week
		// tokens (locale-dependent start, "en" default is Sunday-start) — the
		// two number the last/first week of a year differently near the
		// boundary, so they must resolve through separate moment APIs.
		case "GGGG": return { regex: "\\d{4}", kind: "isoWeekYear" };
		case "gggg": return { regex: "\\d{4}", kind: "localeWeekYear" };
		case "MMMM": return { regex: altRegex(MONTHS), kind: "monthName" };
		case "MMM": return { regex: altRegex(MONTHS_SHORT), kind: "monthNameShort" };
		case "MM": return { regex: "\\d{2}", kind: "monthNum" };
		case "M": return { regex: "\\d{1,2}", kind: "monthNum" };
		case "DD": return { regex: "\\d{2}", kind: "day" };
		case "D": return { regex: "\\d{1,2}", kind: "day" };
		case "WW": return { regex: "\\d{2}", kind: "isoWeek" };
		case "W": return { regex: "\\d{1,2}", kind: "isoWeek" };
		case "ww": return { regex: "\\d{2}", kind: "localeWeek" };
		case "w": return { regex: "\\d{1,2}", kind: "localeWeek" };
		case "dddd": return { regex: altRegex(WEEKDAYS), kind: "weekdayFull" };
		case "ddd": return { regex: altRegex(WEEKDAYS_SHORT), kind: "weekdayShort" };
		case "dd": return { regex: altRegex(WEEKDAYS_MIN), kind: "weekdayMin" };
		case "d": return { regex: "\\d", kind: "weekdayNum" };
		default: return null;
	}
}

/**
 * Mirrors the format-string syntax `noteUtils.formatWithWeekTokens` writes:
 * moment.js tokens, `[literal]` escapes, and `{{weekday:fmt}}` week tokens.
 */
function tokenize(format: string, nested = false): Tokenized {
	let pattern = "";
	const groups: TokenGroup[] = [];
	let i = 0;

	while (i < format.length) {
		const ch = format[i] as string;

		if (ch === "[") {
			const end = format.indexOf("]", i + 1);
			const literal = end === -1 ? format.slice(i + 1) : format.slice(i + 1, end);
			pattern += escapeRegex(literal);
			i = end === -1 ? format.length : end + 1;
			continue;
		}

		if (format.startsWith("{{", i)) {
			const end = format.indexOf("}}", i + 2);
			const colon = end === -1 ? -1 : format.indexOf(":", i + 2);
			if (end !== -1 && colon !== -1 && colon < end) {
				const tokenFmt = format.slice(colon + 1, end);
				const inner = tokenize(tokenFmt, true);
				pattern += inner.pattern;
				groups.push(...inner.groups);
				i = end + 2;
				continue;
			}
		}

		if (TOKEN_CHARS.has(ch)) {
			let j = i + 1;
			while (j < format.length && format[j] === ch) j++;
			const run = format.slice(i, j);
			const built = tokenForRun(run);
			if (built) {
				pattern += `(${built.regex})`;
				groups.push({ kind: built.kind, nested });
			} else {
				pattern += escapeRegex(run);
			}
			i = j;
			continue;
		}

		pattern += escapeRegex(ch);
		i++;
	}

	return { pattern, groups };
}

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

function isMonthOrDayKind(kind: FieldKind): boolean {
	return kind === "monthNum" || kind === "monthName" || kind === "monthNameShort" || kind === "day";
}

interface BuiltDate {
	date: Moment;
	// True once a week-number token decided the date — the only case
	// AC-FMT-04.5 grants any tolerance in, and only for a nested month/day
	// fragment specifically (see matchOne).
	usedWeekPath: boolean;
}

/**
 * Builds one candidate date from the format's own (non-nested) fields.
 * A nested field (from {{weekday:fmt}}) never contributes here — it
 * describes a different day, not the format's own date — and any
 * inconsistency, in a nested or a top-level field alike, is caught
 * afterwards by matchOne's re-render comparison, not here.
 */
function buildDate(match: RegExpExecArray, groups: TokenGroup[]): BuiltDate | null {
	let year: number | undefined;
	let isoWeekYear: number | undefined;
	let localeWeekYear: number | undefined;
	let month: number | undefined;
	let day: number | undefined;
	let isoWeek: number | undefined;
	let localeWeek: number | undefined;

	groups.forEach((group, idx) => {
		if (group.nested) return;
		const raw = match[idx + 1];
		if (raw === undefined) return;
		switch (group.kind) {
			case "year": year ??= parseInt(raw, 10); break;
			case "isoWeekYear": isoWeekYear ??= parseInt(raw, 10); break;
			case "localeWeekYear": localeWeekYear ??= parseInt(raw, 10); break;
			case "monthNum": month ??= parseInt(raw, 10); break;
			case "monthName":
				month ??= MONTHS.findIndex((m) => m.toLowerCase() === raw.toLowerCase()) + 1;
				break;
			case "monthNameShort":
				month ??= MONTHS_SHORT.findIndex((m) => m.toLowerCase() === raw.toLowerCase()) + 1;
				break;
			case "day": day ??= parseInt(raw, 10); break;
			case "isoWeek": isoWeek ??= parseInt(raw, 10); break;
			case "localeWeek": localeWeek ??= parseInt(raw, 10); break;
			default: break; // a top-level weekday name/number never constructs either
		}
	});

	// Week-number tokens win over any month/day fragment in the same format
	// (AC-FMT-04.5) — construction alone doesn't need to detect a conflicting
	// or out-of-range value here; matchOne's re-render comparison rejects
	// anything this candidate cannot actually explain.
	if (isoWeek !== undefined) {
		const wy = isoWeekYear ?? year;
		if (wy === undefined) return null;
		const candidate = window.moment().isoWeekYear(wy).isoWeek(isoWeek).startOf("isoWeek");
		return candidate.isValid() ? { date: candidate, usedWeekPath: true } : null;
	}
	if (localeWeek !== undefined) {
		const wy = localeWeekYear ?? year;
		if (wy === undefined) return null;
		const start = window.moment().weekYear(wy).week(localeWeek).startOf("week");
		if (!start.isValid()) return null;
		// A periodic week's identity is its Monday (see noteUtils'
		// {{monday:..}} convention) even when the format labels the week with
		// locale numbering. .day(1) is only "Monday" when the locale week
		// starts Sun or Mon; for a Tue..Sat week start it lands on the wrong
		// day (even the wrong week), so walk forward from the locale week's
		// real start to the next Monday.
		return { date: start.add((1 - start.isoWeekday() + 7) % 7, "days"), usedWeekPath: true };
	}
	if (year !== undefined && month !== undefined) {
		const candidate = window.moment(`${year}-${pad2(month)}-${pad2(day ?? 1)}`, "YYYY-MM-DD", true);
		return candidate.isValid() ? { date: candidate, usedWeekPath: false } : null;
	}
	return null;
}

function stripMdExtension(path: string): string {
	return /\.md$/i.test(path) ? path.slice(0, -3) : path;
}

function matchOne(input: string, format: string, allowPrefixMatch: boolean): ParseFilenameResult | null {
	const { pattern, groups } = tokenize(format);
	// Case-sensitive: a filename's characters must match the format exactly
	// (AC-FMT-04.1, AC-FMT-04.7) — moment's own output (month/weekday names,
	// [literal] text) is already the correctly-cased string to match against.
	const regex = new RegExp(`^${pattern}`);
	const match = regex.exec(input);
	if (!match) return null;

	const isExact = match[0].length === input.length;
	if (!isExact && !allowPrefixMatch) return null;

	const built = buildDate(match, groups);
	if (!built) return null;

	// The candidate date must reproduce the exact text it was matched
	// against — re-render it through the real forward formatter and compare
	// group by group with the same regex re-applied to that rendering. Any
	// literal portion of the pattern is guaranteed identical between the two
	// matches already (both had to satisfy the same literal regex text), so
	// only captured group values can ever differ. AC-FMT-04.5 exempts only a
	// nested month/day fragment, and only once a week number decides the
	// date — every other field, nested or not, year/week/weekday alike,
	// must still match exactly.
	const rendered = formatWithWeekTokens(format, built.date);
	const renderedMatch = regex.exec(rendered);
	if (!renderedMatch) return null;
	for (const [i, group] of groups.entries()) {
		if (built.usedWeekPath && group.nested && isMonthOrDayKind(group.kind)) continue;
		if (match[i + 1] !== renderedMatch[i + 1]) return null;
	}

	return { date: built.date, prefixMatch: !isExact };
}

/**
 * Parse a vault filename or relative path back into a date, given the
 * format string configured for one granularity. Falls back to matching just
 * the filename against the format's last path segment (AC-FMT-04.2) because
 * a note can be moved out of the nested folder it was originally created in.
 */
export function parseFilename(
	path: string,
	format: string,
	allowPrefixMatch: boolean,
): ParseFilenameResult | null {
	const stripped = stripMdExtension(path);

	const full = matchOne(stripped, format, allowPrefixMatch);
	if (full) return full;

	const lastSlash = format.lastIndexOf("/");
	if (lastSlash === -1) return null;

	const lastSegment = format.slice(lastSlash + 1);
	const basenameSlash = stripped.lastIndexOf("/");
	const basename = basenameSlash === -1 ? stripped : stripped.slice(basenameSlash + 1);

	return matchOne(basename, lastSegment, allowPrefixMatch);
}
