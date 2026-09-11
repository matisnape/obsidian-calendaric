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
