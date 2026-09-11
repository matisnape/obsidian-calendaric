import type { Moment } from "moment";

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
	// Set only for a weekday field nested inside {{weekday:fmt}} — it names
	// that wrapper's ISO weekday (e.g. Sunday=7), not the format's own date,
	// so it must be checked against that specific day, not the overall match.
	anchorIsoWeekday?: number;
}

const WEEKDAY_ISO: Record<string, number> = {
	monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
};

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
function tokenize(format: string, anchorIsoWeekday?: number): Tokenized {
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
				const weekdayName = format.slice(i + 2, colon).toLowerCase();
				const targetIso = WEEKDAY_ISO[weekdayName];
				const tokenFmt = format.slice(colon + 1, end);
				const nested = tokenize(tokenFmt, targetIso);
				pattern += nested.pattern;
				groups.push(...nested.groups);
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
				groups.push({ kind: built.kind, anchorIsoWeekday });
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

function weekdayIndex(kind: FieldKind, raw: string): number | undefined {
	switch (kind) {
		case "weekdayFull": {
			const idx = WEEKDAYS.findIndex((d) => d.toLowerCase() === raw.toLowerCase());
			return idx === -1 ? undefined : idx;
		}
		case "weekdayShort": {
			const idx = WEEKDAYS_SHORT.findIndex((d) => d.toLowerCase() === raw.toLowerCase());
			return idx === -1 ? undefined : idx;
		}
		case "weekdayMin": {
			const idx = WEEKDAYS_MIN.findIndex((d) => d.toLowerCase() === raw.toLowerCase());
			return idx === -1 ? undefined : idx;
		}
		case "weekdayNum":
			return parseInt(raw, 10);
		default:
			return undefined;
	}
}

function buildDate(match: RegExpExecArray, groups: TokenGroup[]): Moment | null {
	let year: number | undefined;
	let isoWeekYear: number | undefined;
	let localeWeekYear: number | undefined;
	let month: number | undefined;
	let day: number | undefined;
	let isoWeek: number | undefined;
	let localeWeek: number | undefined;
	const weekdayChecks: { expected: number; anchorIsoWeekday: number | undefined }[] = [];
	// A format can capture the same field twice (e.g. a nested year folder:
	// "YYYY/YYYY-MM-DD"). Two disagreeing captures mean the string could never
	// have come from a single real date. Tracked per field so a month/day
	// conflict inside a redundant weekday-token fragment (AC-FMT-04.5) doesn't
	// block a match that a week number already resolves unambiguously.
	let yearConflict = false;
	let isoWeekYearConflict = false;
	let localeWeekYearConflict = false;
	let monthConflict = false;
	let dayConflict = false;
	let isoWeekConflict = false;
	let localeWeekConflict = false;
	const combine = (current: number | undefined, next: number): { value: number; conflict: boolean } => ({
		value: current ?? next,
		conflict: current !== undefined && current !== next,
	});

	const isWeekdayKind = (kind: FieldKind): boolean =>
		kind === "weekdayFull" || kind === "weekdayShort" || kind === "weekdayMin" || kind === "weekdayNum";

	// A non-weekday field nested inside {{weekday:fmt}} (e.g. the YYYY-MM-DD in
	// {{sunday:YYYY-MM-DD}}) describes that one specific day, not the format's
	// own date — across a Dec/Jan ISO-week boundary, {{sunday:..}}'s year
	// legitimately differs from the week's year. It never feeds the top-level
	// date/conflict tracking. But it is not meaningless either: when no week
	// number decides the date (AC-FMT-04.5 doesn't apply), it must still
	// describe the real day it names, or a filename like
	// "{{monday:1900-99-99}}" would wrongly pass. Collected here, checked once
	// the date is known.
	const anchoredDateFields = new Map<number, { year?: number; month?: number; day?: number }>();
	const setAnchored = (anchor: number, field: "year" | "month" | "day", value: number) => {
		const entry = anchoredDateFields.get(anchor) ?? {};
		entry[field] = value;
		anchoredDateFields.set(anchor, entry);
	};

	groups.forEach((group, idx) => {
		const raw = match[idx + 1];
		if (raw === undefined) return;
		if (group.anchorIsoWeekday !== undefined && !isWeekdayKind(group.kind)) {
			switch (group.kind) {
				case "year": setAnchored(group.anchorIsoWeekday, "year", parseInt(raw, 10)); break;
				case "monthNum": setAnchored(group.anchorIsoWeekday, "month", parseInt(raw, 10)); break;
				case "monthName":
					setAnchored(group.anchorIsoWeekday, "month", MONTHS.findIndex((m) => m.toLowerCase() === raw.toLowerCase()) + 1);
					break;
				case "monthNameShort":
					setAnchored(group.anchorIsoWeekday, "month", MONTHS_SHORT.findIndex((m) => m.toLowerCase() === raw.toLowerCase()) + 1);
					break;
				case "day": setAnchored(group.anchorIsoWeekday, "day", parseInt(raw, 10)); break;
				default: break; // a nested week-number token is out of scope
			}
			return;
		}
		switch (group.kind) {
			case "year": {
				const r = combine(year, parseInt(raw, 10));
				year = r.value; yearConflict ||= r.conflict; break;
			}
			case "isoWeekYear": {
				const r = combine(isoWeekYear, parseInt(raw, 10));
				isoWeekYear = r.value; isoWeekYearConflict ||= r.conflict; break;
			}
			case "localeWeekYear": {
				const r = combine(localeWeekYear, parseInt(raw, 10));
				localeWeekYear = r.value; localeWeekYearConflict ||= r.conflict; break;
			}
			case "monthNum": {
				const r = combine(month, parseInt(raw, 10));
				month = r.value; monthConflict ||= r.conflict; break;
			}
			case "monthName": {
				const r = combine(month, MONTHS.findIndex((m) => m.toLowerCase() === raw.toLowerCase()) + 1);
				month = r.value; monthConflict ||= r.conflict; break;
			}
			case "monthNameShort": {
				const r = combine(month, MONTHS_SHORT.findIndex((m) => m.toLowerCase() === raw.toLowerCase()) + 1);
				month = r.value; monthConflict ||= r.conflict; break;
			}
			case "day": {
				const r = combine(day, parseInt(raw, 10));
				day = r.value; dayConflict ||= r.conflict; break;
			}
			case "isoWeek": {
				const r = combine(isoWeek, parseInt(raw, 10));
				isoWeek = r.value; isoWeekConflict ||= r.conflict; break;
			}
			case "localeWeek": {
				const r = combine(localeWeek, parseInt(raw, 10));
				localeWeek = r.value; localeWeekConflict ||= r.conflict; break;
			}
			case "weekdayFull":
			case "weekdayShort":
			case "weekdayMin":
			case "weekdayNum": {
				const idx = weekdayIndex(group.kind, raw);
				if (idx !== undefined) weekdayChecks.push({ expected: idx, anchorIsoWeekday: group.anchorIsoWeekday });
				break;
			}
		}
	});

	// Week-number tokens win over any month/day fragment in the same format
	// (AC-FMT-04.5) — a weekday-token's DD.MM display fragment is redundant
	// with the week number and must never override it, including a conflict
	// among the ignored month/day fields themselves.
	let date: Moment | null = null;
	if (isoWeek !== undefined) {
		if (yearConflict || isoWeekYearConflict || isoWeekConflict) return null;
		const wy = isoWeekYear ?? year;
		if (wy === undefined) return null;
		const candidate = window.moment().isoWeekYear(wy).isoWeek(isoWeek).startOf("isoWeek");
		// moment normalises an out-of-range week (e.g. week 99) into some other
		// real week instead of failing — round-trip the captured pair through
		// the constructed date to catch what isValid() cannot.
		if (candidate.isValid() && candidate.isoWeekYear() === wy && candidate.isoWeek() === isoWeek) {
			date = candidate;
		}
	} else if (localeWeek !== undefined) {
		if (yearConflict || localeWeekYearConflict || localeWeekConflict) return null;
		const wy = localeWeekYear ?? year;
		if (wy === undefined) return null;
		const start = window.moment().weekYear(wy).week(localeWeek).startOf("week");
		if (start.isValid() && start.weekYear() === wy && start.week() === localeWeek) {
			// A periodic week's identity is its Monday (see noteUtils'
			// {{monday:..}} convention) even when the format labels the week
			// with locale numbering. .day(1) is only "Monday" when the locale
			// week starts Sun or Mon; for a Tue..Sat week start it lands on the
			// wrong day (even the wrong week), so walk forward from the
			// locale week's real start to the next Monday.
			date = start.add((1 - start.isoWeekday() + 7) % 7, "days");
		}
	} else if (year !== undefined && month !== undefined) {
		if (yearConflict || monthConflict || dayConflict) return null;
		const candidate = window.moment(`${year}-${pad2(month)}-${pad2(day ?? 1)}`, "YYYY-MM-DD", true);
		date = candidate.isValid() ? candidate : null;
	}

	if (!date) return null;

	// Anchored date fragments (e.g. {{monday:YYYY-MM-DD}}) are only ignorable
	// display when a week-number token already resolves the date (AC-FMT-04.5).
	// Otherwise each nested year/month/day must describe its own anchored day.
	if (isoWeek === undefined && localeWeek === undefined) {
		for (const [anchor, fields] of anchoredDateFields) {
			const expected = date.clone().isoWeekday(anchor);
			if (fields.year !== undefined && fields.year !== expected.year()) return null;
			if (fields.month !== undefined && fields.month !== expected.month() + 1) return null;
			if (fields.day !== undefined && fields.day !== expected.date()) return null;
		}
	}

	// A weekday name/number is redundant with Y/M/D or a week number — it must
	// still describe the same date, or the string never formats to this value
	// for any date (AC-FMT-04.1). A weekday nested inside {{weekday:fmt}} names
	// a different day of the same week (e.g. {{sunday:ddd}}), so it is checked
	// against that day, not against the match's own date.
	const mismatch = weekdayChecks.some(({ expected, anchorIsoWeekday }) => {
		const actual = anchorIsoWeekday === undefined ? date.day() : date.clone().isoWeekday(anchorIsoWeekday).day();
		return expected !== actual;
	});
	if (mismatch) return null;

	return date;
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

	const date = buildDate(match, groups);
	if (!date) return null;

	return { date, prefixMatch: !isExact };
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
