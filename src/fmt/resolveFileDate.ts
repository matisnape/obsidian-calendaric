import type { Moment } from "moment";
import type { PeriodicConfig } from "../types";
import type { VaultConfigPort } from "../adapters/vaultConfigPort";
import { resolveNoteFolder } from "../notes/noteUtils";
import { parseFilename } from "./parseFilename";
import { computeNoteDate } from "./noteDate";

export type FileGranularity = "day" | "week";

export interface FileDateIdentity {
	granularity: FileGranularity;
	date: Moment;
	/** The shared identity string — computeNoteDate is what every other feature compares on. */
	noteDate: string;
}

/**
 * Resolve which date and granularity an open file represents, day before week.
 *
 * Day wins a tie because it is the more specific period: a filename that
 * satisfies both formats describes one day, and a whole week is never the
 * better answer for it.
 */
export function resolveFileDate(
	path: string,
	configs: Record<FileGranularity, PeriodicConfig>,
	vaultConfig: VaultConfigPort,
): FileDateIdentity | null {
	for (const granularity of ["day", "week"] as const) {
		const identity = matchGranularity(path, granularity, configs, vaultConfig);
		if (identity) return identity;
	}
	return null;
}

function matchGranularity(
	path: string,
	granularity: FileGranularity,
	configs: Record<FileGranularity, PeriodicConfig>,
	vaultConfig: VaultConfigPort,
): FileDateIdentity | null {
	const config = configs[granularity];
	const relative = stripFolder(path, resolveNoteFolder(config.folder, vaultConfig));
	if (relative === null) return null;

	// ponytail: prefix matching stays off until a setting exposes it — that is
	// the documented default (AC-FMT-04.3), and no config field carries it yet.
	let parsed = parseFilename(relative, config.format, false);
	// A note may sit in a subfolder under the configured folder: the folder
	// scopes the search, it does not fix the depth (AC-FMT-07.1). parseFilename
	// already falls back to the filename when the FORMAT is nested; a
	// slash-free format needs that same fallback applied to the path.
	if (!parsed && !config.format.includes("/")) {
		parsed = parseFilename(basename(relative), config.format, false);
	}
	if (!parsed) return null;

	return {
		granularity,
		date: parsed.date,
		// The weekly format decides where a week starts, so it is passed even
		// for a day: it is what every other caller must pass to agree with this
		// identity (AC-FMT-07.4).
		noteDate: computeNoteDate(parsed.date, granularity, configs.week.format),
	};
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
