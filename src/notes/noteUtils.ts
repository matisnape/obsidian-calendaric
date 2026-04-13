import type { Moment } from "moment";
import type { App } from "obsidian";
import type { PeriodicConfig } from "../types";

const WEEK_TOKEN_RE = /\{\{(monday|tuesday|wednesday|thursday|friday|saturday|sunday):([^}]+)\}\}/gi;

const WEEKDAY_ISO: Record<string, number> = {
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
	sunday: 7,
};

/**
 * Second-pass substitution of `{{weekday:fmt}}` tokens in a format string.
 * Runs after moment.format() — safe because moment never outputs `{{...}}`.
 */
export function applyWeekTokens(fmt: string, date: Moment): string {
	return fmt.replace(WEEK_TOKEN_RE, (_match, weekday: string, tokenFmt: string) => {
		const isoDay = WEEKDAY_ISO[weekday.toLowerCase()];
		if (isoDay === undefined) return _match;
		return date.clone().isoWeekday(isoDay).format(tokenFmt);
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
export function computeNotePath(date: Moment, config: PeriodicConfig, app: App): string {
	const folder = resolveNoteFolder(config.folder, app);
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
 * Resolve the note folder: if empty, fall back to Obsidian's default new-file
 * location setting.
 */
export function resolveNoteFolder(folder: string, app: App): string {
	if (folder.trim() !== "") return folder.trim();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const config = (app.vault as any).config as Record<string, unknown> | undefined;
	if (!config) return "";

	const location = config["newFileLocation"];
	if (location === "folder") {
		const path = config["newFileFolderPath"];
		return typeof path === "string" ? path : "";
	}
	// "root" or "current" — use vault root
	return "";
}
