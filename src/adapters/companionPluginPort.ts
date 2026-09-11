/**
 * The one place a companion plugin's shape is written down. The compiler cannot
 * verify another plugin's runtime object, so nothing outside this boundary may
 * describe it: a read that goes around this type is a read that can be wrong
 * about a plugin the user upgraded independently.
 */
export interface DailyNotesPluginState {
	enabled: boolean;
	format: string;
	folder: string;
	template: string;
	/**
	 * Turns the companion plugin off, already carrying the host's confirm flag.
	 * A bound closure rather than a method, so a caller can hold it on its own
	 * without losing the plugin object it belongs to.
	 */
	disable: () => void;
}

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
