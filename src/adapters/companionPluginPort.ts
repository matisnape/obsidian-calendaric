/**
 * The one place a companion plugin's shape is written down. The compiler cannot
 * verify another plugin's runtime object, so nothing outside this boundary may
 * describe it: a read that goes around this type is a read that can be wrong
 * about a plugin the user upgraded independently.
 *
 * The disabled case carries no settings, because a disabled companion plugin
 * has no settings instance to read. Keeping the two apart means a plugin the
 * user turned off cannot be reported as broken (AC-MIG-01.6).
 */
export type DailyNotesPluginState =
	| { enabled: false }
	| { enabled: true; format: string; folder: string; template: string };

/**
 * Separates a plugin the user simply does not have from one whose object no
 * longer matches what this code expects. Absence is ordinary and stays quiet;
 * a mismatch means an assumption broke and the user has to be told.
 */
export type CompanionPluginReadFailure = "absent" | "mismatch";

/**
 * A read the caller cannot use without deciding what to do when it failed.
 * A plain value would let a mismatch pass as an empty-but-successful result,
 * which is the failure this boundary exists to prevent.
 */
export type CompanionPluginRead<T> =
	| { ok: true; value: T }
	| { ok: false; reason: CompanionPluginReadFailure; problem: string };

/**
 * The outcome of asking a companion plugin to do something. A void return would
 * let a failed write look like a completed one, and a caller that then records
 * the write as done cannot be corrected afterwards.
 */
export type CompanionPluginAction = { ok: true } | { ok: false; problem: string };

export interface CompanionPluginPort {
	readDailyNotes(): CompanionPluginRead<DailyNotesPluginState>;

	/**
	 * Turns the core Daily Notes plugin off. An operation on the port rather
	 * than a function handed out inside the read value: a callable member would
	 * let an implementation supply a method that silently depends on a receiver
	 * the caller does not have, which no function type can rule out.
	 */
	disableDailyNotes(): CompanionPluginAction;
}
