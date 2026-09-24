import type { Moment } from "moment";
import { formatWithWeekTokens, WEEKDAY_ISO, weekdayWithin } from "../notes/noteUtils";

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
	// True for a field nested inside {{weekday:fmt}} — it describes that
	// wrapper's own day, not the format's own date, so it never feeds
	// top-level date construction (see matchOne for validation rules).
	nested?: boolean;
	// Which {{weekday:fmt}} wrapper a nested field came from. Two wrappers
	// describe two different days, so their fields must never be pooled.
	wrapper?: number;
	// The ISO weekday that wrapper renders. The wrapped fields describe THAT
	// day, so a week number among them numbers the week containing it, which
	// is not always the week the format's own date sits in.
	wrapperIsoDay?: number;
}

interface Tokenized {
	pattern: string;
	groups: TokenGroup[];
	tables: LocaleTables;
}

/**
 * Every spelling of each month and weekday, in moment's own indexing.
 *
 * Read from the active locale, not hardcoded: the plugin lets the vault owner
 * override moment's locale and the writer formats names with it, so an
 * English-only table cannot read back a name the plugin itself just wrote.
 *
 * Each entry holds more than one spelling because a locale may inflect a name
 * by position — pl writes "kwiecień" alone and "kwietnia" after a day number.
 * The format string decides which one moment writes, so it is asked for that
 * one, and the standalone form is kept alongside it. Accepting either is safe:
 * matchOne's re-render comparison rejects a candidate whose own rendering
 * disagrees with the name.
 */
interface LocaleTables {
	months: string[][];
	monthsShort: string[][];
	weekdays: string[][];
	weekdaysShort: string[][];
	weekdaysMin: string[][];
	/** The ten digit glyphs this locale writes numbers with. */
	digits: string;
}

function unique(...names: string[]): string[] {
	return [...new Set(names)];
}

/**
 * moment rewrites its own finished output before returning it: 23 bundled
 * locales replace the ASCII digits with their own numerals, and some rewrite
 * punctuation too — ar writes "٢٠٢٦-٠٤-١٥، الأربعاء" where the format says
 * "YYYY-MM-DD[, ]dddd". That rewritten form is what lands in the filename, so
 * it is what a pattern has to match. preparse is moment's own inverse.
 */
function postformat(text: string): string {
	return window.moment.localeData().postformat(text);
}

function preparse(text: string): string {
	return window.moment.localeData().preparse(text);
}

function digitClass(digits: string, min: number, max = min): string {
	const set = [...new Set(digits)].map(escapeRegex).join("");
	return `[${set}]{${min}${max === min ? "" : `,${max}`}}`;
}

function localeTables(format: string): LocaleTables {
	const data = window.moment.localeData();
	const months = Array.from({ length: 12 }, (_, i) => window.moment().date(1).month(i));
	const days = Array.from({ length: 7 }, (_, i) => window.moment().day(i));

	return {
		months: months.map((m) => unique(data.months(m, format), data.months(m, "MMMM"))),
		monthsShort: months.map((m) => unique(data.monthsShort(m, format), data.monthsShort(m, "MMM"))),
		weekdays: days.map((d) => unique(data.weekdays(d, format), data.weekdays(d, "dddd"))),
		weekdaysShort: days.map((d) => unique(data.weekdaysShort(d))),
		weekdaysMin: days.map((d) => unique(data.weekdaysMin(d))),
		digits: postformat("0123456789"),
	};
}

function mergeTables(outer: LocaleTables, inner: LocaleTables): LocaleTables {
	const merge = (a: string[][], b: string[][]) => a.map((names, i) => unique(...names, ...(b[i] ?? [])));
	return {
		months: merge(outer.months, inner.months),
		monthsShort: merge(outer.monthsShort, inner.monthsShort),
		weekdays: merge(outer.weekdays, inner.weekdays),
		weekdaysShort: merge(outer.weekdaysShort, inner.weekdaysShort),
		weekdaysMin: merge(outer.weekdaysMin, inner.weekdaysMin),
		digits: outer.digits,
	};
}

function indexOfName(table: string[][], raw: string): number {
	return table.findIndex((names) => names.some((name) => name.toLowerCase() === raw.toLowerCase()));
}

const TOKEN_CHARS = new Set(["Y", "G", "g", "M", "D", "W", "w", "d"]);

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Longest spelling first, so a short name can never shadow a longer one it is
 * a prefix of — a real hazard once the names come from an arbitrary locale.
 */
function altRegex(table: string[][]): string {
	return table
		.flat()
		.map(postformat)
		.sort((a, b) => b.length - a.length)
		.map(escapeRegex)
		.join("|");
}

function tokenForRun(run: string, tables: LocaleTables): { regex: string; kind: FieldKind } | null {
	switch (run) {
		case "YYYY": return { regex: digitClass(tables.digits, 4), kind: "year" };
		// GGGG/WW are ISO week tokens (Monday-start); gggg/ww are locale week
		// tokens (locale-dependent start, "en" default is Sunday-start) — the
		// two number the last/first week of a year differently near the
		// boundary, so they must resolve through separate moment APIs.
		case "GGGG": return { regex: digitClass(tables.digits, 4), kind: "isoWeekYear" };
		case "gggg": return { regex: digitClass(tables.digits, 4), kind: "localeWeekYear" };
		case "MMMM": return { regex: altRegex(tables.months), kind: "monthName" };
		case "MMM": return { regex: altRegex(tables.monthsShort), kind: "monthNameShort" };
		case "MM": return { regex: digitClass(tables.digits, 2), kind: "monthNum" };
		case "M": return { regex: digitClass(tables.digits, 1, 2), kind: "monthNum" };
		case "DD": return { regex: digitClass(tables.digits, 2), kind: "day" };
		case "D": return { regex: digitClass(tables.digits, 1, 2), kind: "day" };
		case "WW": return { regex: digitClass(tables.digits, 2), kind: "isoWeek" };
		case "W": return { regex: digitClass(tables.digits, 1, 2), kind: "isoWeek" };
		case "ww": return { regex: digitClass(tables.digits, 2), kind: "localeWeek" };
		case "w": return { regex: digitClass(tables.digits, 1, 2), kind: "localeWeek" };
		case "dddd": return { regex: altRegex(tables.weekdays), kind: "weekdayFull" };
		case "ddd": return { regex: altRegex(tables.weekdaysShort), kind: "weekdayShort" };
		case "dd": return { regex: altRegex(tables.weekdaysMin), kind: "weekdayMin" };
		case "d": return { regex: digitClass(tables.digits, 1), kind: "weekdayNum" };
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
	let tables = localeTables(format);
	let wrappers = 0;
	let i = 0;

	while (i < format.length) {
		const ch = format[i] as string;

		if (ch === "[") {
			const end = format.indexOf("]", i + 1);
			const literal = end === -1 ? format.slice(i + 1) : format.slice(i + 1, end);
			pattern += escapeRegex(postformat(literal));
			i = end === -1 ? format.length : end + 1;
			continue;
		}

		if (format.startsWith("{{", i)) {
			const end = format.indexOf("}}", i + 2);
			const colon = end === -1 ? -1 : format.indexOf(":", i + 2);
			// Only the seven real weekday names are wrappers; formatWithWeekTokens
			// substitutes nothing else, so anything else is not one.
			const wrapperIsoDay = colon === -1 ? undefined : WEEKDAY_ISO[format.slice(i + 2, colon).toLowerCase()];
			if (end !== -1 && colon !== -1 && colon < end && wrapperIsoDay !== undefined) {
				const tokenFmt = format.slice(colon + 1, end);
				const inner = tokenize(tokenFmt, true);
				const wrapper = wrappers++;
				// A wrapper's own format may draw a different inflection out of
				// the locale, so its spellings join the table used for lookup.
				tables = mergeTables(tables, inner.tables);
				pattern += inner.pattern;
				groups.push(...inner.groups.map((group) => ({ ...group, wrapper, wrapperIsoDay })));
				i = end + 2;
				continue;
			}
		}

		// moment reads a backslash as "render the next token literally", and it
		// consumes exactly one token: "\WWW" is the literal "WW" followed by a
		// real ISO week token, and "\YYYY" is the literal "YYYY". An escaped
		// backslash renders as nothing at all.
		if (ch === "\\" && i + 1 < format.length) {
			const escaped = format[i + 1] as string;
			let j = i + 1;
			while (j < format.length && format[j] === escaped) j++;
			let run = format.slice(i + 1, j);
			while (run.length > 1 && !tokenForRun(run, tables)) run = run.slice(0, -1);
			pattern += escaped === "\\" ? "" : escapeRegex(postformat(run));
			i += 1 + run.length;
			continue;
		}

		if (TOKEN_CHARS.has(ch)) {
			let j = i + 1;
			while (j < format.length && format[j] === ch) j++;
			const run = format.slice(i, j);
			const built = tokenForRun(run, tables);
			if (built) {
				pattern += `(${built.regex})`;
				groups.push({ kind: built.kind, nested });
			} else {
				pattern += escapeRegex(postformat(run));
			}
			i = j;
			continue;
		}

		pattern += escapeRegex(postformat(ch));
		i++;
	}

	return { pattern, groups, tables };
}

export type WeekSemantics = "iso" | "locale";

/**
 * Which week numbering a format string encodes, or null when it numbers no
 * week at all. GGGG/WW are ISO tokens, gggg/ww are locale tokens, and the two
 * disagree about which week a Sunday belongs to — so an identity anchored on
 * the wrong one contradicts the date this module parses out of the same name.
 *
 * Reuses the tokenizer rather than scanning the raw string, so an escaped
 * `[ww]` literal stays literal, and mirrors buildDate's precedence: ISO wins a
 * format carrying both, and a field nested in {{weekday:fmt}} describes that
 * wrapper's own day, never the format's week.
 *
 * Only top-level tokens count. A week token inside {{weekday:fmt}} is rendered
 * off a day already pinned inside the source date's configured week, so such a
 * format partitions dates by that week whatever numbering it prints.
 *
 * US-CAL-01's getWeekNumber(date, weekFormat) reads the same format strings but
 * answers a different question — which number to display, not how to partition
 * dates — so the two stay separate helpers; only this tokenizer should be
 * shared once both branches are on master.
 */
export function weekSemantics(format: string): WeekSemantics | null {
	const topLevel = tokenize(format).groups.filter((group) => !group.nested);
	if (topLevel.some((group) => group.kind === "isoWeek")) return "iso";
	if (topLevel.some((group) => group.kind === "localeWeek")) return "locale";
	return null;
}

/** Whether the format carries a {{weekday:fmt}} span formatWithWeekTokens substitutes. */
export function hasWeekdayWrapper(format: string): boolean {
	return tokenize(format).groups.some((group) => group.wrapper !== undefined);
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
	// AC-FMT-04.5 grants any tolerance in, and only for a month/day-kind
	// field, nested or not (see matchOne).
	usedWeekPath: boolean;
}

/**
 * Every date the captured fields could describe, best first: the top-level
 * fields, then each {{weekday:fmt}} wrapper on its own. matchOne re-renders
 * them in order and keeps the first that reproduces the name, because building
 * a date and explaining a name are different things — "{{monday:YYYY-MM}}"
 * builds the 1st of the month and explains nothing, while a second wrapper in
 * the same format may carry the whole date.
 *
 * A nested field describes a different day than the format's own date, so
 * top-level fields are tried first and alone.
 *
 * When a format names its date ONLY through wrappers — `{{monday:GGGG-[W]WW}}`
 * is a whole weekly format on its own — there is no top-level date to build,
 * and discarding the nested fields would make a name the plugin itself writes
 * unreadable. Every wrapper resolves inside the configured week, so whichever
 * day it names lies in the source date's own week: mapping the wrapped date to
 * the Monday inside that week gives the date this module returns for every
 * weekly match. matchOne's re-render check then rejects the
 * candidate if it does not reproduce the name.
 */
function buildCandidates(match: RegExpExecArray, groups: TokenGroup[], tables: LocaleTables): BuiltDate[] {
	const candidates: BuiltDate[] = [];

	const topLevel = buildFrom(match, groups, (group) => !group.nested, tables);
	if (topLevel) candidates.push(topLevel);

	const wrappers = new Map(
		groups.filter((group) => group.wrapper !== undefined).map((group) => [group.wrapper, group]),
	);
	for (const [wrapper, sample] of wrappers) {
		const built = buildFrom(match, groups, (group) => group.wrapper === wrapper, tables, sample.wrapperIsoDay);
		// Every wrapper renders inside the configured week (AC-FMT-03.2), so the
		// day it names lies in the format's own week; that week's Monday is the
		// date every weekly match returns.
		const weekStart = window.moment.localeData().firstDayOfWeek();
		if (built) candidates.push({ date: weekdayWithin(built.date, 1, weekStart), usedWeekPath: built.usedWeekPath });
	}
	return candidates;
}

function buildFrom(
	match: RegExpExecArray,
	groups: TokenGroup[],
	include: (group: TokenGroup) => boolean,
	tables: LocaleTables,
	wrapperIsoDay?: number,
): BuiltDate | null {
	let year: number | undefined;
	let isoWeekYear: number | undefined;
	let localeWeekYear: number | undefined;
	let month: number | undefined;
	let day: number | undefined;
	let isoWeek: number | undefined;
	let localeWeek: number | undefined;

	groups.forEach((group, idx) => {
		if (!include(group)) return;
		const raw = match[idx + 1];
		if (raw === undefined) return;
		switch (group.kind) {
			case "year": year ??= parseInt(preparse(raw), 10); break;
			case "isoWeekYear": isoWeekYear ??= parseInt(preparse(raw), 10); break;
			case "localeWeekYear": localeWeekYear ??= parseInt(preparse(raw), 10); break;
			case "monthNum": month ??= parseInt(preparse(raw), 10); break;
			case "monthName": month ??= indexOfName(tables.months, raw) + 1; break;
			case "monthNameShort": month ??= indexOfName(tables.monthsShort, raw) + 1; break;
			case "day": day ??= parseInt(preparse(raw), 10); break;
			case "isoWeek": isoWeek ??= parseInt(preparse(raw), 10); break;
			case "localeWeek": localeWeek ??= parseInt(preparse(raw), 10); break;
			default: break; // a weekday name/number never constructs either
		}
	});

	// Week-number tokens win over any month/day fragment in the same format
	// (AC-FMT-04.5) — construction alone doesn't need to detect a conflicting
	// or out-of-range value here; matchOne's re-render comparison rejects
	// anything this candidate cannot actually explain.
	// The day a week number names: the wrapper's own weekday inside that week,
	// or the week's Monday when the format names its date directly. Taking the
	// week start for a wrapper loses the named day, which matters whenever that
	// day's week number is not the week number of the format's own date.
	const isoDay = wrapperIsoDay ?? 1;

	if (isoWeek !== undefined) {
		const wy = isoWeekYear ?? year;
		if (wy === undefined) return null;
		const candidate = window.moment().isoWeekYear(wy).isoWeek(isoWeek).startOf("isoWeek");
		return candidate.isValid()
			? { date: candidate.add(isoDay - 1, "days"), usedWeekPath: true }
			: null;
	}
	if (localeWeek !== undefined) {
		const wy = localeWeekYear ?? year;
		if (wy === undefined) return null;
		const start = window.moment().weekYear(wy).week(localeWeek).startOf("week");
		if (!start.isValid()) return null;
		// A periodic week's identity is its Monday (see noteUtils'
		// {{monday:..}} convention) even when the format labels the week with
		// locale numbering. .day(n) is only the ISO weekday when the locale week
		// starts Sun or Mon; for a Tue..Sat week start it lands on the wrong
		// day (even the wrong week), so walk forward from the locale week's
		// real start to the wanted weekday inside it.
		return { date: start.add((isoDay - start.isoWeekday() + 7) % 7, "days"), usedWeekPath: true };
	}
	// A year alone is a whole format: `YYYY` is what a yearly note is named
	// with, and a month is not missing from it, it is simply not part of what
	// that period is. The same holds for a month with no day. matchOne's
	// re-render check still rejects a candidate that cannot explain the name,
	// so filling the gaps here cannot widen what actually matches.
	if (year !== undefined) {
		const candidate = window.moment(`${year}-${pad2(month ?? 1)}-${pad2(day ?? 1)}`, "YYYY-MM-DD", true);
		return candidate.isValid() ? { date: candidate, usedWeekPath: false } : null;
	}
	return null;
}

function stripMdExtension(path: string): string {
	return /\.md$/i.test(path) ? path.slice(0, -3) : path;
}

function matchOne(input: string, format: string, allowPrefixMatch: boolean): ParseFilenameResult | null {
	const { pattern, groups, tables } = tokenize(format);
	// Case-sensitive: a filename's characters must match the format exactly
	// (AC-FMT-04.1, AC-FMT-04.7) — moment's own output (month/weekday names,
	// [literal] text) is already the correctly-cased string to match against.
	const regex = new RegExp(`^${pattern}`);
	const match = regex.exec(input);
	if (!match) return null;

	const isExact = match[0].length === input.length;
	if (!isExact && !allowPrefixMatch) return null;

	// The candidate date must reproduce the exact text it was matched
	// against, or it never describes it at all. Comparing captured group
	// values suffices — any literal portion of the pattern is already
	// guaranteed identical between the two matches (both had to satisfy the
	// same literal text to match at all). AC-FMT-04.5 exempts any month/day
	// fragment (nested in {{weekday:fmt}} or not — the AC names no such
	// restriction) once a week number decides the date; every other field,
	// year/week/weekday alike, must still match exactly.
	for (const built of buildCandidates(match, groups, tables)) {
		const rendered = formatWithWeekTokens(format, built.date);
		const renderedMatch = regex.exec(rendered);
		if (!renderedMatch) continue;

		const explains = groups.every((group, i) =>
			(built.usedWeekPath && isMonthOrDayKind(group.kind)) || match[i + 1] === renderedMatch[i + 1],
		);
		if (explains) return { date: built.date, prefixMatch: !isExact };
	}

	return null;
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
