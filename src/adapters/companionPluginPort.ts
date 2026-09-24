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

/**
 * The Calendar plugin, as far as it can still create notes on its own.
 *
 * Its one setting that does is `showWeeklyNote`: with it on, the grid shows
 * week numbers and a click on one creates a weekly note. Its weekly format,
 * folder and template fields are dead in the surveyed build
 * (docs/mapping/sources/cal.json), and it has no daily switch of its own --
 * the daily notes it creates follow Daily Notes' or Periodic Notes' settings.
 *
 * A port of its own rather than two more members on `CompanionPluginPort`,
 * which the Daily Notes import and its tests implement in full.
 */
export interface CalendarPluginPort {
	/**
	 * Whether an enabled Calendar plugin has weekly notes on. Probes the
	 * dev-build id before the published one (AC-MIG-06.3); a plugin that is
	 * not enabled under either reads as `absent`.
	 */
	readCalendarWeeklyNotes(): CompanionPluginRead<boolean>;

	/**
	 * Turns `showWeeklyNote` off through the plugin's own `writeOptions`, which
	 * is what its settings tab calls and what saves its data.json. `ok` only
	 * once the plugin's saved data reads the setting back off.
	 */
	disableCalendarWeeklyNotes(): Promise<CompanionPluginAction>;
}

/**
 * One granularity's entry inside a Periodic Notes calendar set.
 *
 * Five fields, because those are the five the import carries (US-MIG-04).
 * `allowPrefixMatch` is among them by DEC-18: it has a direct equivalent in
 * Calendaric's own model, and this vault's weekly notes are renamed to a longer
 * title after creation, so dropping the flag would stop them resolving at all.
 *
 * `openAtStartup` is the one entry field deliberately left out. Calendaric lets
 * exactly one granularity open a note at startup (`clearStartupNote`), and a
 * calendar set carrying the flag on two granularities would import a state this
 * plugin treats as impossible.
 */
export interface PeriodicNotesGranularityConfig {
	enabled: boolean;
	format: string;
	folder: string;
	templatePath: string;
	allowPrefixMatch: boolean;
}

/**
 * The one calendar set Periodic Notes reports as active.
 *
 * A single set rather than the list, because the import must never merge two of
 * them (AC-MIG-04.3), and a type that cannot hold the others cannot merge them.
 * Which set is active is that plugin's decision, read from its own manager.
 *
 * `granularities` is keyed by the names that plugin uses, not by Calendaric's
 * `Granularity`: a build that names one this version does not know must not turn
 * the whole read into a failure.
 */
export interface PeriodicNotesCalendarSet {
	id: string;
	granularities: Readonly<Record<string, PeriodicNotesGranularityConfig>>;
}

/**
 * What Periodic Notes governs, asked of the plugin rather than inferred.
 *
 * That plugin computes the answer itself, from whichever calendar set is
 * active, and publishes it as `calendarSetManager.getActiveGranularities()`.
 * Its `settings` field is a Svelte store, so a read of `settings.day.enabled`
 * yields undefined on every build that has one -- the defect recorded against
 * `periodic-notes-weekly-detection` in docs/mapping/sources/cal.json, which
 * shipped as "weekly notes are off" for every user who had them on.
 *
 * The value is the names that plugin reports, not Calendaric's own Granularity
 * type: they are another plugin's strings, and a build that names a granularity
 * this one does not know must not turn the whole read into a failure.
 */
export interface PeriodicNotesPort {
	readActiveGranularities(): CompanionPluginRead<readonly string[]>;

	/**
	 * The active calendar set's per-granularity folder, format, template and
	 * enabled flag (AC-MIG-04.1).
	 *
	 * Separate from `readActiveGranularities` because it answers a different
	 * question: that one asks what the plugin governs, this one asks with what.
	 * A caller that needs only the names must not have to narrow a whole set.
	 */
	readActiveCalendarSet(): CompanionPluginRead<PeriodicNotesCalendarSet>;

	/**
	 * Switches one granularity off in the active calendar set (AC-MIG-06.5).
	 *
	 * Written through the plugin's own settings store, the way its settings tab
	 * writes: the plugin subscribes to that store and saves its data.json on
	 * every change. `ok` only once the plugin has said it saved, and its saved
	 * data reads the granularity back off.
	 */
	disableGranularity(name: string): Promise<CompanionPluginAction>;
}
