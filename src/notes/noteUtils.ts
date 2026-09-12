import type { Moment } from "moment";
import type { PeriodicConfig } from "../types";
import type { VaultConfigPort } from "../adapters/vaultConfigPort";
import type { VaultPort } from "../adapters/vaultPort";

const WEEK_TOKEN_RE = /\{\{(monday|tuesday|wednesday|thursday|friday|saturday|sunday):([^}]+)\}\}/gi;

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
 * Compute the full vault path (folder + filename + .md) for a periodic note.
 *
 * Strategy: week tokens like `{{monday:DD.MM}}` contain moment format chars
 * (D, M, etc.) that would be corrupted by `date.format()`. We protect them by
 * extracting them first, replacing with safe placeholders, running moment.format(),
 * then substituting the resolved weekday dates back in.
 */
export function computeNotePath(date: Moment, config: PeriodicConfig, vaultConfig: VaultConfigPort): string {
	const folder = resolveNoteFolder(config.folder, vaultConfig);
	const filename = formatWithWeekTokens(config.format, date);
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
export function formatWithWeekTokens(fmt: string, date: Moment): string {
	const sanitised = fmt.replace(WEEK_TOKEN_RE, (_match, weekday: string, tokenFmt: string) => {
		const isoDay = WEEKDAY_ISO[weekday.toLowerCase()];
		if (isoDay === undefined) return _match;
		const resolved = date.clone().isoWeekday(isoDay).format(tokenFmt);
		// Wrap in moment escape brackets so moment.format() treats it as a literal
		return `[${resolved}]`;
	});

	return date.format(sanitised);
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
 * resolves it — `{{monday:GGGG-[W]WW}}` writes 2026-W52 for Sun 2026-12-27,
 * whose own locale week is 1.
 *
 * When no token anywhere names a week the filename carries no week number to
 * agree with, and the locale week is shown. The column still has to show
 * something: AC-CAL-01.4 asks for a week-number cell on every row.
 */
export function getWeekNumber(date: Moment, weekFormat: string): number {
	const topLevel = weekNumberFor(date, tokenChars(weekFormat.replace(WEEK_TOKEN_RE, "")));
	if (topLevel !== null) return topLevel;

	for (const [, weekday = "", tokenFmt = ""] of weekFormat.matchAll(WEEK_TOKEN_RE)) {
		const isoDay = WEEKDAY_ISO[weekday.toLowerCase()];
		if (isoDay === undefined) continue;
		const nested = weekNumberFor(date.clone().isoWeekday(isoDay), tokenChars(tokenFmt));
		if (nested !== null) return nested;
	}

	return date.week();
}
