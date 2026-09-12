import { DEFAULT_PERIODIC_CONFIG, PeriodicConfig } from "../types";
import type { Granularity } from "../types";

/** Every granularity Calendaric knows, in the order the UI and the commands use. */
export const GRANULARITIES: readonly Granularity[] = ["day", "week", "month", "quarter", "year"];

export const WEEK_START_OPTIONS = [
	"locale",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
] as const;

export type WeekStartOption = (typeof WEEK_START_OPTIONS)[number];

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
 * One named configuration group: an id plus one stored entry per granularity.
 *
 * Every part is optional, down to the individual fields of an entry, because a
 * stored group is kept exactly as it was written: it may predate a granularity,
 * carry only the fields it needs, or — hand-edited — have lost its id.
 * `toSettings` fills the gaps for the group in use, and that projection is a
 * view rather than what gets saved.
 */
export interface CalendarSet extends Partial<Record<Granularity, Partial<PeriodicConfig>>> {
	id?: string;
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

/** Day and week are the two granularities a new vault starts with. */
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
		allowPrefixMatch: asBoolean(raw.allowPrefixMatch, DEFAULT_PERIODIC_CONFIG.allowPrefixMatch),
		openAtStartup: asBoolean(raw.openAtStartup, DEFAULT_PERIODIC_CONFIG.openAtStartup),
	};
}

const CONFIG_FIELDS = [
	"enabled",
	"format",
	"folder",
	"templatePath",
	"allowPrefixMatch",
	"openAtStartup",
] as const;

function asWeekStart(value: unknown, fallback: WeekStartOption): WeekStartOption {
	return WEEK_START_OPTIONS.find((option) => option === value) ?? fallback;
}

function pickGlobals(source: unknown): GlobalSettings {
	const raw: Record<string, unknown> = isRecord(source) ? source : {};
	return {
		weekStart: asWeekStart(raw.weekStart, DEFAULT_GLOBALS.weekStart),
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
 * user. Every stored group, the one in use included, is carried through exactly
 * as it was written: defaults are filled in by `toSettings`, which is a view and
 * not what gets saved. That is what lets a group nobody can reach yet survive a
 * load and a save untouched.
 *
 * Not handled here: an older stored shape that keeps day/week/... at the top
 * level instead of inside a group. Adopting those keys into the group is
 * US-MIG-07's; until then they are preserved but not read.
 */
export function loadStoredConfig(raw: unknown): StoredConfig {
	if (!isRecord(raw)) return defaultStoredConfig();

	const storedSets = Array.isArray(raw.calendarSets)
		? (raw.calendarSets.filter(isRecord) as CalendarSet[])
		: [];
	const calendarSets = storedSets.length > 0 ? storedSets : [defaultCalendarSet()];

	// The fallback is the first group, so name it by its own id. Falling back to a
	// literal "Default" would hand the group in use to a *later* group that happens
	// to carry that id, and edits would land in the wrong group.
	const requested = asString(raw.activeCalendarSet, "");
	const activeCalendarSet = calendarSets.some((set) => set.id === requested)
		? requested
		: asString(calendarSets[0]?.id, "");

	return {
		...raw,
		...pickGlobals(raw),
		activeCalendarSet,
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

export function getActiveSet(stored: StoredConfig): CalendarSet {
	return stored.calendarSets[activeSetIndex(stored)] ?? defaultCalendarSet(stored.activeCalendarSet);
}

/** Flattens the group in use, defaults filled in — a view, not the saved shape. */
export function toSettings(stored: StoredConfig): CalendaricSettings {
	const active = getActiveSet(stored);
	const configs = {} as GranularityConfigs;
	for (const granularity of GRANULARITIES) {
		configs[granularity] = normalizeConfig(active[granularity]);
	}
	return { ...pickGlobals(stored), ...configs };
}

/**
 * Write edited settings back into the group in use.
 *
 * Only the fields whose value actually changed are written, and only for the
 * granularities that have one. A granularity the stored group never mentioned
 * stays unmentioned, a field it never carried stays absent, and an unchanged
 * save writes the file back as it was. Every other group is passed through by
 * reference, so nothing outside the group in use can be rewritten.
 */
export function applySettings(stored: StoredConfig, settings: CalendaricSettings): StoredConfig {
	const active = getActiveSet(stored);
	const updated: CalendarSet = { ...active };
	for (const granularity of GRANULARITIES) {
		const storedConfig = active[granularity];
		const projected = normalizeConfig(storedConfig);
		const edited = settings[granularity];

		const patched: Record<string, unknown> = { ...storedConfig };
		let touched = false;
		for (const field of CONFIG_FIELDS) {
			if (projected[field] === edited[field]) continue;
			patched[field] = edited[field];
			touched = true;
		}
		if (touched) updated[granularity] = patched as Partial<PeriodicConfig>;
	}

	const index = activeSetIndex(stored);
	const calendarSets =
		stored.calendarSets.length > 0
			? stored.calendarSets.map((set, position) => (position === index ? updated : set))
			: [updated];

	return { ...stored, ...pickGlobals(settings), calendarSets };
}

/**
 * The documented built-in format each granularity falls back to when its own
 * format is left empty (AC-SET-03.1). One table, so the settings screen's
 * placeholder, the Daily Notes import and the resolver cannot drift apart.
 */
export const DEFAULT_FORMATS: Record<Granularity, string> = {
	day: "YYYY-MM-DD",
	week: "gggg-[W]ww",
	month: "YYYY-MM",
	quarter: "YYYY-[Q]Q",
	year: "YYYY",
};

/** Anything carrying stored per-granularity entries: flattened settings, or a stored group. */
type ConfigSource = Partial<Record<Granularity, unknown>>;

/**
 * The one read path to a granularity's effective format, folder, template and
 * prefix-match setting (US-SET-03).
 *
 * Calendaric's own stored configuration is the only source consulted: no
 * companion plugin's file is read here, so a vault whose core Daily Notes
 * settings disagree cannot change what Calendaric resolves (AC-SET-03.4).
 * An empty folder and an empty template path are answers, not gaps -- the vault
 * root, and no template (AC-SET-03.2). A hand-edited value of the wrong type is
 * replaced by the built-in default for that one field, leaving the rest of the
 * granularity intact (AC-SET-03.5).
 *
 * The result is a fresh object every call, so one caller cannot alter what the
 * next one resolves (AC-SET-03.3).
 */
export function resolveEffectiveConfig(source: ConfigSource, granularity: Granularity): PeriodicConfig {
	const config = normalizeConfig(source[granularity]);
	if (config.format === "") config.format = DEFAULT_FORMATS[granularity];
	return config;
}

/** Anything that can answer whether a granularity is on: flattened settings, or a stored group. */
export type EnabledSource = Partial<Record<Granularity, { enabled?: boolean }>>;

export function getActiveGranularities(configs: EnabledSource): Granularity[] {
	return GRANULARITIES.filter((granularity) => configs[granularity]?.enabled === true);
}

export function getInactiveGranularities(configs: EnabledSource): Granularity[] {
	return GRANULARITIES.filter((granularity) => configs[granularity]?.enabled !== true);
}

/** Only one granularity may open a note at startup, so clear the flag everywhere. */
export function clearStartupNote(settings: CalendaricSettings): void {
	for (const granularity of GRANULARITIES) {
		settings[granularity].openAtStartup = false;
	}
}
