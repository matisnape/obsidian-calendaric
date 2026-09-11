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
		const identity = matchGranularity(path, granularity, configs[granularity], vaultConfig);
		if (identity) return identity;
	}
	return null;
}

function matchGranularity(
	path: string,
	granularity: FileGranularity,
	config: PeriodicConfig,
	vaultConfig: VaultConfigPort,
): FileDateIdentity | null {
	const relative = stripFolder(path, resolveNoteFolder(config.folder, vaultConfig));
	if (relative === null) return null;

	// ponytail: prefix matching stays off until a setting exposes it — that is
	// the documented default (AC-FMT-04.3), and no config field carries it yet.
	const parsed = parseFilename(relative, config.format, false);
	if (!parsed) return null;

	return {
		granularity,
		date: parsed.date,
		noteDate: computeNoteDate(parsed.date, granularity),
	};
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
