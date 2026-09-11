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
	| {
			enabled: true;
			format: string;
			folder: string;
			template: string;
			/**
			 * Turns the companion plugin off, already carrying the host's confirm
			 * flag. Declared as taking no receiver, so a caller may hold it on its
			 * own: the implementation has to close over the object it belongs to
			 * rather than depend on how it is called.
			 */
			disable: (this: void) => void;
	  };

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

export interface CompanionPluginPort {
	readDailyNotes(): CompanionPluginRead<DailyNotesPluginState>;
}
