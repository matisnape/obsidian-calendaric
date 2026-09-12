import type { Moment } from "moment";
import type { PeriodicConfig, ReleaseGranularity } from "../types";
import { RELEASE_GRANULARITIES } from "../types";
import type { VaultConfigPort } from "../adapters/vaultConfigPort";
import { resolveNoteFolder } from "../notes/noteUtils";
import { parseFilename } from "./parseFilename";
import { computeNoteDate } from "./noteDate";

/**
 * The granularities a file can be resolved to: every one this release writes
 * notes for (US-CMD-05). Was day and week alone, which left month and year
 * without the existence lookup their navigation commands ask for.
 */
export type FileGranularity = ReleaseGranularity;

/**
 * The configuration this resolver reads, one entry per granularity it should
 * consider. Partial on purpose: a granularity the vault has switched off is
 * simply absent, and an absent granularity claims no file.
 */
export type FileConfigs = Partial<Record<FileGranularity, PeriodicConfig>>;

export interface FileDateIdentity {
	granularity: FileGranularity;
	date: Moment;
	/** The shared identity string — computeNoteDate is what every other feature compares on. */
	noteDate: string;
	/**
	 * True when the filename only STARTS with what the format writes, matched
	 * under the granularity's opt-in prefix setting (AC-FMT-04.3). It is carried
	 * out of here because it decides precedence between two files naming the
	 * same period (AC-FMT-08.1), which this function alone cannot see.
	 */
	prefixMatch: boolean;
}

/**
 * Resolve which date and granularity an open file represents, narrowest period
 * first: day, then week, then month, then year.
 *
 * The narrower period wins a tie because it is the more specific one: a
 * filename that satisfies both a daily and a weekly format describes one day,
 * and a whole week is never the better answer for it. The same argument carries
 * up the chain, which is why the order is `RELEASE_GRANULARITIES` itself.
 */
export function resolveFileDate(
	path: string,
	configs: FileConfigs,
	vaultConfig: VaultConfigPort,
): FileDateIdentity | null {
	for (const granularity of RELEASE_GRANULARITIES) {
		const identity = matchGranularity(path, granularity, configs, vaultConfig);
		if (identity) return identity;
	}
	return null;
}

function matchGranularity(
	path: string,
	granularity: FileGranularity,
	configs: FileConfigs,
	vaultConfig: VaultConfigPort,
): FileDateIdentity | null {
	const config = configs[granularity];
	if (!config) return null;

	const relative = stripFolder(path, resolveNoteFolder(config.folder, vaultConfig));
	if (relative === null) return null;

	// Prefix matching is the granularity's own opt-in (US-SET-01), off by default.
	let parsed = parseFilename(relative, config.format, config.allowPrefixMatch);
	// A note may sit in a subfolder under the configured folder: the folder
	// scopes the search, it does not fix the depth (AC-FMT-07.1). parseFilename
	// already falls back to the filename when the FORMAT is nested; a
	// slash-free format needs that same fallback applied to the path.
	if (!parsed && !config.format.includes("/")) {
		parsed = parseFilename(basename(relative), config.format, config.allowPrefixMatch);
	}
	if (!parsed) return null;

	return {
		granularity,
		date: parsed.date,
		// The weekly format decides where a week starts, so it is passed even
		// for a day: it is what every other caller must pass to agree with this
		// identity (AC-FMT-07.4).
		noteDate: computeNoteDate(parsed.date, granularity, configs.week?.format ?? ""),
		prefixMatch: parsed.prefixMatch,
	};
}

/**
 * The one note for a period, picked out of candidate vault paths.
 *
 * An exact match wins over a prefix match: a file the format writes verbatim IS
 * that period's note, and a longer name that merely starts with it is a second
 * reading of the same period, never an equal one (AC-FMT-08.1). Only one path
 * comes back, so no caller can quietly treat the loser as an alternative.
 *
 * Below that the lowest path wins, because a caller's list order is exactly the
 * unspecified thing this story exists to remove: the same vault must answer the
 * same file however the paths arrived.
 */
export function resolvePeriodNote(
	paths: readonly string[],
	noteDate: string,
	configs: FileConfigs,
	vaultConfig: VaultConfigPort,
): string | null {
	const candidates: { path: string; prefixMatch: boolean }[] = [];

	for (const path of paths) {
		const identity = resolveFileDate(path, configs, vaultConfig);
		if (identity?.noteDate === noteDate) candidates.push({ path, prefixMatch: identity.prefixMatch });
	}

	candidates.sort(
		(a, b) => Number(a.prefixMatch) - Number(b.prefixMatch) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
	);

	return candidates[0]?.path ?? null;
}

function basename(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/**
 * Returns the path relative to the granularity's folder, or null when the file
 * is not under it — a matching filename elsewhere in the vault is not that
 * period's note (AC-FMT-07.5).
 */
function stripFolder(path: string, folder: string): string | null {
	const trimmed = folder.replace(/^\/+|\/+$/g, "");
	if (trimmed === "") return path;
	return path.startsWith(`${trimmed}/`) ? path.slice(trimmed.length + 1) : null;
}
