import type { Moment } from "moment";
import type { Granularity, PeriodicConfig } from "../types";
import type { VaultConfigPort } from "../adapters/vaultConfigPort";
import type { VaultPort } from "../adapters/vaultPort";

/**
 * `{{monday:DD.MM}}` — a weekday name and the format to print its date in.
 *
 * The format group excludes `{` as well as `}`, for the reason `DATE_OFFSET_RE`
 * in templateTokens.ts does (AC-TPL-06.5): left to cross `{`, an unclosed
 * `{{monday:DD` runs on to the NEXT token's closing braces, so both tokens
 * disappear and the text between them is formatted as a moment pattern.
 * `{{monday:DD {{monday:MM}}` rendered "13 {{0on1am2026:04" before the `{` was
 * excluded here.
 */
const WEEK_TOKEN_RE = /\{\{(monday|tuesday|wednesday|thursday|friday|saturday|sunday):([^{}]+)\}\}/gi;

/**
 * Any `{{name:fmt}}` span, whether or not the name is a weekday. Every span is
 * written either resolved or as typed, so none of them is ever a top-level token.
 */
const SPAN_RE = /\{\{([^{}:]+):([^{}]+)\}\}/g;

/**
 * A moment escape, a `[literal]` or a span, leftmost first: `\\[` opens no literal,
 * and a span's own `[W]` stays inside the span match.
 */
const BRACKET_OR_SPAN_RE = new RegExp(`\\\\.|\\[[^\\]]*\\]|${SPAN_RE.source}`, "g");

/** The seven names `{{weekday:fmt}}` accepts, and the ISO weekday each resolves to. */
export const WEEKDAY_ISO: Record<string, number> = {
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
	sunday: 7,
};

/**
 * That weekday's date inside `date`'s own seven-day week (DEC-01).
 *
 * The week runs from its configured first day, never from the ISO Monday. Both
 * arguments are moment's `day()` numbering, 0=Sunday through 6=Saturday, which
 * is what `resolveWeekStart` hands out; `WEEKDAY_ISO` holds ISO numbers, so `% 7`
 * folds its Sunday (7) onto moment's Sunday (0).
 *
 * Sun 2026-04-12 is the case the numbering exists for. Under `weekStart` 0 that
 * Sunday OPENS the week 12–18 April, so its Monday is 13 April, the next day.
 * Under `weekStart` 1 the same date CLOSES the week 6–12 April, so its Monday is
 * 6 April. `isoWeekday(1)` answers 6 April for both, which is the bug.
 *
 * This is the display side's rule, in one expression rather than a second one:
 * `getMonthGrid` walks back to the `weekStart` day on or before its first date
 * and `getWeekAnchor` reads the week off that day.
 */
export function weekdayWithin(date: Moment, isoDay: number, weekStart: number): Moment {
	const weekOpened = date.clone().subtract((date.day() - weekStart + 7) % 7, "day");
	return weekOpened.add(((isoDay % 7) - weekStart + 7) % 7, "day");
}

/**
 * The first day of the week a filename format's `{{weekday:fmt}}` spans resolve
 * within, as moment's `day()` number.
 *
 * The configured week (AC-FMT-03.2), unless the format names an ISO week or ISO
 * year at top level: ISO tokens stay Monday-based, and a span must fall in the
 * week the format itself names, or one ISO week would be written under two
 * filenames and two weeks under one.
 */
export function spanWeekStart(format: string): number {
	if (/[GW]/.test(tokenChars(format.replace(SPAN_RE, "")))) return 1;
	return window.moment.localeData().firstDayOfWeek();
}

/**
 * Second-pass substitution of `{{weekday:fmt}}` tokens in a format string.
 * Runs after moment.format() — safe because moment never outputs `{{...}}`.
 *
 * `weekStart` is moment's `day()` numbering, 0=Sunday through 6=Saturday.
 */
export function applyWeekTokens(fmt: string, date: Moment, weekStart: number): string {
	return fmt.replace(WEEK_TOKEN_RE, (_match, weekday: string, tokenFmt: string) => {
		const isoDay = WEEKDAY_ISO[weekday.toLowerCase()];
		if (isoDay === undefined) return _match;
		return weekdayWithin(date, isoDay, weekStart).format(tokenFmt);
	});
}

/**
 * The format with every `{{name:fmt}}` span escaped to literal text, except a
 * weekday span in a weekly format. A weekday within the week means nothing for
 * any other period (AC-FMT-01.4), and an unknown name is kept as typed rather
 * than read by moment as tokens (AC-FMT-01.5). Each character gets moment's
 * backslash escape, which the parser reads the same way, so the writer and the
 * parser agree on the literal. A bracket escape would not do: the span's own
 * format may hold `[` or `]`. A span already inside a `[literal]` is left alone,
 * since moment prints a backslash there as typed.
 */
export function literalWeekTokens(fmt: string, granularity: Granularity): string {
	return fmt.replace(BRACKET_OR_SPAN_RE, (match, name?: string) =>
		name === undefined || (granularity === "week" && WEEKDAY_ISO[name.toLowerCase()] !== undefined)
			? match
			: match.replace(/./g, "\\$&"),
	);
}

/** The names of the `{{name:fmt}}` spans that are not weekdays, in order (AC-FMT-01.6). */
export function unknownTokenNames(fmt: string): string[] {
	return [...fmt.matchAll(SPAN_RE)]
		.map(([, name = ""]) => name)
		.filter((name) => WEEKDAY_ISO[name.toLowerCase()] === undefined);
}

/**
 * Compute the full vault path (folder + filename + .md) for a periodic note.
 *
 * Strategy: week tokens like `{{monday:DD.MM}}` contain moment format chars
 * (D, M, etc.) that would be corrupted by `date.format()`. We protect them by
 * extracting them first, replacing with safe placeholders, running moment.format(),
 * then substituting the resolved weekday dates back in.
 */
export function computeNotePath(
	date: Moment,
	config: PeriodicConfig,
	vaultConfig: VaultConfigPort,
	// Production callers must pass it; left out, weekday tokens resolve as before US-FMT-01.
	granularity: Granularity = "week",
): string {
	const folder = resolveNoteFolder(config.folder, vaultConfig);
	const filename = formatWithWeekTokens(config.format, date, granularity);
	return folder ? `${folder}/${filename}.md` : `${filename}.md`;
}

/**
 * Format a date using a format string that may contain both moment.js tokens
 * and Calendaric week tokens (`{{weekday:fmt}}`).
 *
 * Strategy: extract week tokens first, resolve them, replace with
 * moment-escaped literals `[value]`, then run moment.format(). The escaped
 * literals pass through moment unchanged.
 */
export function formatWithWeekTokens(format: string, date: Moment, granularity: Granularity): string {
	const fmt = literalWeekTokens(format, granularity);
	// A moment keeps the locale it was made under. Re-reading the global one is
	// what makes a date held across a settings change write with the new locale
	// and week start (AC-FMT-03.3).
	const local = date.clone().locale(window.moment.locale());
	const weekStart = spanWeekStart(fmt);
	const sanitised = fmt.replace(WEEK_TOKEN_RE, (_match, weekday: string, tokenFmt: string) => {
		const isoDay = WEEKDAY_ISO[weekday.toLowerCase()];
		if (isoDay === undefined) return _match;
		// Within the configured week, so every day of one calendar row writes
		// the same weekly file (AC-FMT-03.2); within the ISO week for an ISO format.
		const resolved = weekdayWithin(local, isoDay, weekStart).format(tokenFmt);
		// Wrap in moment escape brackets so moment.format() treats it as a literal
		return `[${resolved}]`;
	});

	return local.format(sanitised);
}

/**
 * Resolve the note folder: if none is configured, fall back to Obsidian's
 * default new-file location setting.
 *
 * Emptiness is judged before the slashes come off, because `/` is the user
 * naming the vault root. That is a configured answer and it must win over the
 * Obsidian default, unlike a folder left unset.
 */
export function resolveNoteFolder(folder: string, vaultConfig: VaultConfigPort): string {
	if (folder.trim() !== "") return normaliseFolder(folder);

	return normaliseFolder(vaultConfig.getDefaultNewFileFolder());
}

/** Leading and trailing slashes carry no meaning in a vault path. */
function normaliseFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/g, "");
}

export interface NoteFolderCheck {
	/** The folder after the default-location fallback. `""` is the vault root. */
	path: string;
	valid: boolean;
	/**
	 * The folder is missing and will be created when the note is written, so
	 * this flag reports a pending action rather than an error.
	 */
	notYetCreated: boolean;
}

/**
 * A segment no vault can hold: empty, or one that walks the path instead of
 * naming a folder.
 *
 * Shared like `folderChainSegments`, so the check and the creation apply the
 * same rule instead of one of them knowing it alone.
 */
export function hasUnusableSegment(path: string): boolean {
	// The vault root is a destination rather than a segment, so it has none.
	if (path === "") return false;

	return path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

/**
 * Every folder the chain down to `path` is made of, shallowest first.
 *
 * Both the check below and the creation in `noteCreate` walk this list, so the
 * two cannot disagree about which folders the chain contains.
 */
export function folderChainSegments(path: string): string[] {
	if (path === "") return [];

	const segments = path.split("/");
	return segments.map((_segment, index) => segments.slice(0, index + 1).join("/"));
}

/**
 * Check a configured folder path ahead of note creation.
 *
 * Every folder in the chain is judged, not only the last one, because creation
 * walks the whole chain and fails at the first segment it cannot make.
 *
 * A missing folder is never a rejection: `createNote` builds the chain on
 * demand, so a caller showing this to the user reports it, not blocks on it.
 */
export function checkNoteFolder(
	folder: string,
	vaultConfig: VaultConfigPort,
	vault: VaultPort,
): NoteFolderCheck {
	const path = resolveNoteFolder(folder, vaultConfig);

	// The vault root is always there, so it is never pending creation.
	if (path === "") return { path, valid: true, notYetCreated: false };

	if (hasUnusableSegment(path)) return { path, valid: false, notYetCreated: false };

	const chain = folderChainSegments(path);

	// Anything that is not a folder already owning a segment stops creation
	// there, so the whole chain is unusable however deep the clash sits.
	if (chain.some((segment) => !vault.folderExists(segment) && vault.pathExists(segment))) {
		return { path, valid: false, notYetCreated: false };
	}

	return { path, valid: true, notYetCreated: chain.some((segment) => !vault.folderExists(segment)) };
}

/**
 * The characters of `format` that moment reads as tokens, with both of its
 * escapes removed.
 *
 * Moment escapes two ways and each one hides a week token. A `[...]` span
 * prints verbatim, so the default `gggg-[W]ww` writes a literal "W". A
 * backslash makes the token run after it literal, so `\WW` writes "WW" rather
 * than an ISO week. The two are not interchangeable: an unterminated `[` is not
 * an escape at all — moment prints the bracket and keeps reading tokens, which
 * is why `gggg-[Www` renders "2027-[5201".
 *
 * A backslash escapes exactly one token, so the scan consumes at most two
 * identical characters after it — moment's longest week token, `WW` or `ww`.
 * `\WWW` therefore writes a literal "WW" and still leaves a real `W` behind.
 * Two is the right cap for every question this scan answers: a longer run
 * belongs to some other token, and mis-splitting one of those cannot invent or
 * hide a `w` or a `W`.
 */
function tokenChars(format: string): string {
	let chars = "";

	for (let i = 0; i < format.length; i++) {
		const ch = format[i];

		if (ch === "[") {
			const end = format.indexOf("]", i + 1);
			if (end !== -1) {
				i = end;
				continue;
			}
		} else if (ch === "\\") {
			const escaped = format[i + 1];
			i++;
			if (escaped !== undefined && format[i + 1] === escaped) i++;
			continue;
		}

		chars += ch;
	}

	return chars;
}

/** Reads a week number off `date` using whichever week token `tokens` carries. */
function weekNumberFor(date: Moment, tokens: string): number | null {
	if (tokens.includes("W")) return date.isoWeek();
	if (tokens.includes("w")) return date.week();
	return null;
}

/**
 * The week number the plugin shows for a date.
 *
 * The weekly-note format decides, because the same number is printed into the
 * weekly note's filename by `formatWithWeekTokens`, and moment's ISO week
 * (`W`/`WW`) and locale week (`w`/`ww`) name a week differently near a year
 * boundary: 2026-12-28 is ISO 2026-W53 but locale 2027-W01. Deriving both from
 * one function keeps the calendar's week column and the note name from naming
 * the same week two ways.
 *
 * A top-level token wins, because moment resolves it against this date. Failing
 * that, the number comes from the first `{{weekday:fmt}}` span that names a
 * week, resolved against its own weekday exactly as `formatWithWeekTokens`
 * resolves it — under a Monday start `{{monday:GGGG-[W]WW}}` writes 2026-W52
 * for Sun 2026-12-27, whose own locale week is 1.
 *
 * When no token anywhere names a week the filename carries no week number to
 * agree with, and the locale week is shown. The column still has to show
 * something: AC-CAL-01.4 asks for a week-number cell on every row.
 */
export function getWeekNumber(date: Moment, weekFormat: string): number {
	const topLevel = weekNumberFor(date, tokenChars(weekFormat.replace(SPAN_RE, "")));
	if (topLevel !== null) return topLevel;

	for (const [, weekday = "", tokenFmt = ""] of weekFormat.matchAll(WEEK_TOKEN_RE)) {
		const isoDay = WEEKDAY_ISO[weekday.toLowerCase()];
		if (isoDay === undefined) continue;
		const nested = weekNumberFor(weekdayWithin(date, isoDay, spanWeekStart(weekFormat)), tokenChars(tokenFmt));
		if (nested !== null) return nested;
	}

	return date.week();
}
