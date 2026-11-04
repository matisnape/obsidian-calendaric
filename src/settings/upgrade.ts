import { GRANULARITIES, defaultGranularityConfigs, getActiveSet, isRecord, loadStoredConfig, unreadableFields } from "./model";
import type { CalendarSet, StoredConfig } from "./model";

/**
 * The stored shape this version writes, kept in the file as `configVersion`.
 *
 *   1  the granularities sit at the top level (before US-SET-01)
 *   2  the granularities sit inside named groups, `calendarSets`
 *
 * Raise it, and add a step to `readStoredConfig`, whenever the stored shape changes.
 */
export const CONFIG_VERSION = 2;

export interface LoadedConfig {
	stored: StoredConfig;
	/** The file was in an older shape and was upgraded: write it back once. */
	upgraded: boolean;
	/** Something on disk could not be read and its default is used instead: tell the user. */
	reset: boolean;
}

/**
 * The version a file was written by. A file from before the marker existed is
 * told apart by its shape: only version 1 put a granularity at the top level.
 */
function storedVersion(raw: Record<string, unknown>): number {
	if (typeof raw.configVersion === "number") return raw.configVersion;
	return GRANULARITIES.some((granularity) => isRecord(raw[granularity])) ? 1 : CONFIG_VERSION;
}

/**
 * A top-level granularity that is not an object: a hand-edited version 1 entry,
 * dropped by the upgrade or left unread. A newer version may use those keys.
 */
function hasStrayEntry(raw: Record<string, unknown>, version: number): boolean {
	if (version > CONFIG_VERSION) return false;
	return GRANULARITIES.some((granularity) => raw[granularity] !== undefined && !isRecord(raw[granularity]));
}

/**
 * Version 1 to 2: move the top-level granularities into the group in use.
 *
 * A file can carry both, when a version 2 build loaded a version 1 file and
 * saved it: that build filled a fresh group with defaults and kept the old
 * entries beside it, unread. So a group value wins only where it differs from
 * the default, which is a value someone set; elsewhere the old value is kept.
 */
function adoptTopLevelGranularities(raw: Record<string, unknown>): Record<string, unknown> {
	const rest: Record<string, unknown> = { ...raw };
	for (const granularity of GRANULARITIES) delete rest[granularity];
	const stored = loadStoredConfig(rest);
	const active = getActiveSet(stored);
	const defaults = defaultGranularityConfigs();

	const merged: CalendarSet = { ...active };
	for (const granularity of GRANULARITIES) {
		const old = raw[granularity];
		if (!isRecord(old)) continue;
		const group = active[granularity];
		const entry: Record<string, unknown> = isRecord(group) ? { ...group } : {};
		const fallback = defaults[granularity] as unknown as Record<string, unknown>;
		for (const [field, value] of Object.entries(old)) {
			if (entry[field] === undefined || entry[field] === fallback[field]) entry[field] = value;
		}
		merged[granularity] = entry;
	}

	return { ...stored, calendarSets: stored.calendarSets.map((set) => (set === active ? merged : set)) };
}

/**
 * Read whatever `loadData()` returned, upgrading an older shape (AC-MIG-07.1).
 *
 * `undefined` is what Obsidian's `loadData` resolves when `data.json` exists
 * but cannot be parsed; `null` is a missing file, a fresh install.
 */
export function readStoredConfig(raw: unknown): LoadedConfig {
	if (!isRecord(raw)) {
		const stored = loadStoredConfig(raw);
		return { stored: { ...stored, configVersion: CONFIG_VERSION }, upgraded: false, reset: raw !== null };
	}

	const version = storedVersion(raw);
	const upgraded = version < CONFIG_VERSION;
	try {
		const source = upgraded ? adoptTopLevelGranularities(raw) : raw;
		const stored = loadStoredConfig(source);
		return {
			// Never lower the marker: a newer version's file stays marked as its own.
			stored: { ...stored, configVersion: Math.max(version, CONFIG_VERSION) },
			upgraded,
			// Both: the adoption reads the globals of `raw` through their type guards,
			// and only `source` holds the adopted granularities.
			reset: unreadableFields(raw).length > 0 || unreadableFields(source).length > 0 || hasStrayEntry(raw, version),
		};
	} catch {
		// A failed upgrade writes nothing (AC-MIG-07.5). The file is read as it
		// stands, its marker unchanged, so the next load tries the upgrade again.
		return { stored: loadStoredConfig(raw), upgraded: false, reset: true };
	}
}
