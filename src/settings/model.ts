import { DEFAULT_PERIODIC_CONFIG, PeriodicConfig } from "../types";

/** Every granularity Calendaric knows, in the order the UI and the commands use. */
export const GRANULARITIES = ["day", "week", "month", "quarter", "year"] as const;

export type Granularity = (typeof GRANULARITIES)[number];

export type WeekStartOption =
	| "locale"
	| "monday"
	| "tuesday"
	| "wednesday"
	| "thursday"
	| "friday"
	| "saturday"
	| "sunday";

/** Settings that belong to the plugin as a whole, not to any one granularity. */
export interface GlobalSettings {
	weekStart: WeekStartOption;
	showWeekNumbers: boolean;
	confirmBeforeCreate: boolean;
	overrideLocale: string;
	hasMigratedDailyNoteSettings: boolean;
}

export type GranularityConfigs = Record<Granularity, PeriodicConfig>;

/**
 * One named configuration group: an id plus one `PeriodicConfig` per granularity.
 *
 * Granularity configs are optional because stored data may predate a granularity,
 * and because a group the user has never opened may carry only the parts it needs.
 * `loadStoredConfig` fills the gaps for the group in use; other groups stay verbatim.
 */
export interface CalendarSet extends Partial<GranularityConfigs> {
	id: string;
}

/** The shape Calendaric persists: globals plus the named configuration groups. */
export interface StoredConfig extends GlobalSettings {
	activeCalendarSet: string;
	calendarSets: CalendarSet[];
}

/** Globals plus the in-use group's granularity configs, flattened for the rest of the plugin. */
export interface CalendaricSettings extends GlobalSettings, GranularityConfigs {}

export const DEFAULT_CALENDAR_SET_ID = "Default";

const DEFAULT_GLOBALS: GlobalSettings = {
	weekStart: "monday",
	showWeekNumbers: true,
	confirmBeforeCreate: true,
	overrideLocale: "",
	hasMigratedDailyNoteSettings: false,
};

/** Fresh-install granularity configs. Day and week are the two a new vault starts with. */
export function defaultGranularityConfigs(): GranularityConfigs {
	return {
		day: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
		week: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
		month: { ...DEFAULT_PERIODIC_CONFIG },
		quarter: { ...DEFAULT_PERIODIC_CONFIG },
		year: { ...DEFAULT_PERIODIC_CONFIG },
	};
}

export const DEFAULT_SETTINGS: CalendaricSettings = {
	...DEFAULT_GLOBALS,
	...defaultGranularityConfigs(),
};

export function defaultCalendarSet(id: string = DEFAULT_CALENDAR_SET_ID): CalendarSet {
	return { id, ...defaultGranularityConfigs() };
}

export function defaultStoredConfig(): StoredConfig {
	return {
		...DEFAULT_GLOBALS,
		activeCalendarSet: DEFAULT_CALENDAR_SET_ID,
		calendarSets: [defaultCalendarSet()],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/**
 * Fill one stored granularity config with the built-in defaults for whatever it
 * does not carry. Keys this version does not know are kept, so a newer version's
 * field survives a round trip through an older one.
 */
function normalizeConfig(raw: unknown): PeriodicConfig {
	if (!isRecord(raw)) return { ...DEFAULT_PERIODIC_CONFIG };
	return {
		...raw,
		enabled: asBoolean(raw.enabled, DEFAULT_PERIODIC_CONFIG.enabled),
		format: asString(raw.format, DEFAULT_PERIODIC_CONFIG.format),
		folder: asString(raw.folder, DEFAULT_PERIODIC_CONFIG.folder),
		templatePath: asString(raw.templatePath, DEFAULT_PERIODIC_CONFIG.templatePath),
		allowPrefixMatching: asBoolean(raw.allowPrefixMatching, DEFAULT_PERIODIC_CONFIG.allowPrefixMatching),
		openAtStartup: asBoolean(raw.openAtStartup, DEFAULT_PERIODIC_CONFIG.openAtStartup),
	};
}

/** Give the group in use all five granularity configs, without touching its other keys. */
function normalizeSet(set: CalendarSet): CalendarSet {
	const normalized: CalendarSet = { ...set };
	for (const granularity of GRANULARITIES) {
		normalized[granularity] = normalizeConfig(set[granularity]);
	}
	return normalized;
}

function pickGlobals(source: unknown): GlobalSettings {
	const raw: Record<string, unknown> = isRecord(source) ? source : {};
	const weekStart = raw.weekStart;
	return {
		weekStart: typeof weekStart === "string" ? (weekStart as WeekStartOption) : DEFAULT_GLOBALS.weekStart,
		showWeekNumbers: asBoolean(raw.showWeekNumbers, DEFAULT_GLOBALS.showWeekNumbers),
		confirmBeforeCreate: asBoolean(raw.confirmBeforeCreate, DEFAULT_GLOBALS.confirmBeforeCreate),
		overrideLocale: asString(raw.overrideLocale, DEFAULT_GLOBALS.overrideLocale),
		hasMigratedDailyNoteSettings: asBoolean(
			raw.hasMigratedDailyNoteSettings,
			DEFAULT_GLOBALS.hasMigratedDailyNoteSettings,
		),
	};
}

/**
 * Read whatever `loadData()` returned into a usable configuration.
 *
 * A fresh install gets exactly one implicit group, named here rather than by the
 * user. Groups beyond the one in use are carried through untouched, so a second
 * group survives even though no UI can reach it yet.
 *
 * ponytail: an older flat shape (day/week/... at the top level) is not adopted
 * into the group here — that upgrade is US-MIG-07's. Its keys are preserved, so
 * nothing is lost in the meantime.
 */
export function loadStoredConfig(raw: unknown): StoredConfig {
	if (!isRecord(raw)) return defaultStoredConfig();

	const storedSets = Array.isArray(raw.calendarSets)
		? raw.calendarSets
				.filter(isRecord)
				.map((set): CalendarSet => ({ ...set, id: asString(set.id, DEFAULT_CALENDAR_SET_ID) }))
		: [];
	const calendarSets = storedSets.length > 0 ? storedSets : [defaultCalendarSet()];

	const requested = asString(raw.activeCalendarSet, "");
	const index = Math.max(
		calendarSets.findIndex((set) => set.id === requested),
		0,
	);
	const activeSet = calendarSets[index] as CalendarSet;
	calendarSets[index] = normalizeSet(activeSet);

	return {
		...raw,
		...pickGlobals(raw),
		activeCalendarSet: activeSet.id,
		calendarSets,
	};
}

/**
 * Where the group in effect sits in the list. Positional, because two groups can
 * carry the same id and only one of them is the one being edited. Falls back to
 * the first group when `activeCalendarSet` names one that is gone.
 */
function activeSetIndex(stored: StoredConfig): number {
	return Math.max(
		stored.calendarSets.findIndex((set) => set.id === stored.activeCalendarSet),
		0,
	);
}

/** The group currently in effect. */
export function getActiveSet(stored: StoredConfig): CalendarSet {
	return stored.calendarSets[activeSetIndex(stored)] ?? defaultCalendarSet(stored.activeCalendarSet);
}

/** Flatten the group in use into the settings object the rest of the plugin reads. */
export function toSettings(stored: StoredConfig): CalendaricSettings {
	const active = getActiveSet(stored);
	const configs = {} as GranularityConfigs;
	for (const granularity of GRANULARITIES) {
		configs[granularity] = normalizeConfig(active[granularity]);
	}
	return { ...pickGlobals(stored), ...configs };
}

/**
 * Write edited settings back into the group in use. Every other group is passed
 * through by reference, so nothing outside the active group can be rewritten.
 */
export function applySettings(stored: StoredConfig, settings: CalendaricSettings): StoredConfig {
	const active = getActiveSet(stored);
	const updated: CalendarSet = { ...active };
	for (const granularity of GRANULARITIES) {
		updated[granularity] = { ...active[granularity], ...settings[granularity] };
	}

	const index = activeSetIndex(stored);
	const calendarSets =
		stored.calendarSets.length > 0
			? stored.calendarSets.map((set, position) => (position === index ? updated : set))
			: [updated];

	return { ...stored, ...pickGlobals(settings), calendarSets };
}

/** Granularities whose notes are switched on, in day-to-year order. */
export function getActiveGranularities(configs: Partial<GranularityConfigs>): Granularity[] {
	return GRANULARITIES.filter((granularity) => configs[granularity]?.enabled === true);
}

/** Granularities whose notes are switched off, in day-to-year order. */
export function getInactiveGranularities(configs: Partial<GranularityConfigs>): Granularity[] {
	return GRANULARITIES.filter((granularity) => configs[granularity]?.enabled !== true);
}

/** Only one granularity may open a note at startup, so clear the flag everywhere. */
export function clearStartupNote(settings: CalendaricSettings): void {
	for (const granularity of GRANULARITIES) {
		settings[granularity].openAtStartup = false;
	}
}
