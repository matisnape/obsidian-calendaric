import type { Moment } from "moment";

export interface ParseFilenameResult {
	date: Moment;
	prefixMatch: boolean;
}

type FieldKind =
	| "year"
	| "weekYear"
	| "monthNum"
	| "monthName"
	| "monthNameShort"
	| "day"
	| "isoWeek"
	| "ignore";

interface TokenGroup {
	kind: FieldKind;
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
		case "GGGG": return { regex: "\\d{4}", kind: "weekYear" };
		case "gggg": return { regex: "\\d{4}", kind: "weekYear" };
		case "MMMM": return { regex: altRegex(MONTHS), kind: "monthName" };
		case "MMM": return { regex: altRegex(MONTHS_SHORT), kind: "monthNameShort" };
		case "MM": return { regex: "\\d{2}", kind: "monthNum" };
		case "M": return { regex: "\\d{1,2}", kind: "monthNum" };
		case "DD": return { regex: "\\d{2}", kind: "day" };
		case "D": return { regex: "\\d{1,2}", kind: "day" };
		case "WW": return { regex: "\\d{2}", kind: "isoWeek" };
		case "W": return { regex: "\\d{1,2}", kind: "isoWeek" };
		case "ww": return { regex: "\\d{2}", kind: "isoWeek" };
		case "w": return { regex: "\\d{1,2}", kind: "isoWeek" };
		case "dddd": return { regex: altRegex(WEEKDAYS), kind: "ignore" };
		case "ddd": return { regex: altRegex(WEEKDAYS_SHORT), kind: "ignore" };
		case "dd": return { regex: altRegex(WEEKDAYS_MIN), kind: "ignore" };
		case "d": return { regex: "\\d", kind: "ignore" };
		default: return null;
	}
}

/**
 * Mirrors the format-string syntax `noteUtils.formatWithWeekTokens` writes:
 * moment.js tokens, `[literal]` escapes, and `{{weekday:fmt}}` week tokens.
 */
function tokenize(format: string): Tokenized {
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
				const nested = tokenize(tokenFmt);
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
				groups.push({ kind: built.kind });
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

function buildDate(match: RegExpExecArray, groups: TokenGroup[]): Moment | null {
	let year: number | undefined;
	let weekYear: number | undefined;
	let month: number | undefined;
	let day: number | undefined;
	let isoWeek: number | undefined;

	groups.forEach((group, idx) => {
		const raw = match[idx + 1];
		if (raw === undefined) return;
		switch (group.kind) {
			case "year": year ??= parseInt(raw, 10); break;
			case "weekYear": weekYear ??= parseInt(raw, 10); break;
			case "monthNum": month ??= parseInt(raw, 10); break;
			case "monthName":
				month ??= MONTHS.findIndex((m) => m.toLowerCase() === raw.toLowerCase()) + 1;
				break;
			case "monthNameShort":
				month ??= MONTHS_SHORT.findIndex((m) => m.toLowerCase() === raw.toLowerCase()) + 1;
				break;
			case "day": day ??= parseInt(raw, 10); break;
			case "isoWeek": isoWeek ??= parseInt(raw, 10); break;
			case "ignore": break;
		}
	});

	// Week-number tokens win over any month/day fragment in the same format
	// (AC-FMT-04.5) — a weekday-token's DD.MM display fragment is redundant
	// with the week number and must never override it.
	if (isoWeek !== undefined) {
		const wy = weekYear ?? year;
		if (wy === undefined) return null;
		const date = window.moment().isoWeekYear(wy).isoWeek(isoWeek).startOf("isoWeek");
		return date.isValid() ? date : null;
	}

	if (year === undefined || month === undefined) return null;
	const date = window.moment(`${year}-${pad2(month)}-${pad2(day ?? 1)}`, "YYYY-MM-DD", true);
	return date.isValid() ? date : null;
}

function stripMdExtension(path: string): string {
	return /\.md$/i.test(path) ? path.slice(0, -3) : path;
}

function matchOne(input: string, format: string, allowPrefixMatch: boolean): ParseFilenameResult | null {
	const { pattern, groups } = tokenize(format);
	const regex = new RegExp(`^${pattern}`, "i");
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
