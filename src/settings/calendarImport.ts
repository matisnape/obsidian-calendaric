import type {
	CalendarPluginSettings,
	CalendarSettingsPort,
	CompanionPluginPort,
	PeriodicNotesPort,
} from "../adapters/companionPluginPort";
import { WEEK_START_OPTIONS, isWordsPerDot } from "./model";
import type { CalendaricSettings } from "./model";
import { resolveImportSources } from "./importSource";
import type { ImportSource } from "./importSource";

export type CalendarImportFieldId =
	| "weekStart"
	| "confirmBeforeCreate"
	| "showWeekNumbers"
	| "wordsPerDot"
	| "overrideLocale"
	| "week.enabled"
	| "week.format"
	| "week.folder"
	| "week.templatePath";

/**
 * One value the import would change. `value` is what gets written; `current`
 * and `incoming` are only for showing side by side (AC-MIG-03.5).
 */
export interface CalendarImportField {
	id: CalendarImportFieldId;
	label: string;
	value: string | number | boolean;
	current: string;
	incoming: string;
}

/** A Calendar plugin value Calendaric has no equivalent for, shown instead of guessed. */
export interface CalendarUnmappedValue {
	label: string;
	value: string;
	reason: string;
}

export interface CalendarImportPlan {
	/** Written as soon as the user imports. */
	changes: CalendarImportField[];
	/** A customised week folder, format or template: written only once confirmed. */
	conflicts: CalendarImportField[];
	unmapped: CalendarUnmappedValue[];
}

export type CalendarImportCard =
	| { kind: "hidden" }
	| { kind: "unreadable"; problem: string }
	| { kind: "offer"; plan: CalendarImportPlan };

export interface CalendarImportPorts {
	calendar: CalendarSettingsPort;
	periodicNotes: Pick<PeriodicNotesPort, "readActiveGranularities">;
	companion: Pick<CompanionPluginPort, "readDailyNotes">;
}

type Incoming = Omit<CalendarImportField, "current" | "incoming">;

/** Empty or blank counts as unset (AC-MIG-03.8). A set value is trimmed, as the Calendar plugin trims its folder and template. */
function text(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * The Calendar plugin's values in Calendaric's terms, in the order the card
 * lists them. Week fields are left out when Periodic Notes governs week:
 * that is where the Calendar plugin takes them from then, and US-MIG-04
 * imports them from there (AC-MIG-03.2).
 */
function translate(
	source: CalendarPluginSettings,
	weekFromCalendar: boolean,
	locales: readonly string[] | undefined,
): { incoming: Incoming[]; unmapped: CalendarUnmappedValue[] } {
	const incoming: Incoming[] = [];
	const unmapped: CalendarUnmappedValue[] = [];

	const weekStart = text(source.weekStart);
	if (weekStart !== undefined) {
		const option = WEEK_START_OPTIONS.find((candidate) => candidate === weekStart);
		if (option) incoming.push({ id: "weekStart", label: "Week start", value: option });
		else unmapped.push({ label: "Week start", value: weekStart, reason: "not a day Calendaric can start a week on" });
	}
	if (source.shouldConfirmBeforeCreate !== undefined) {
		incoming.push({ id: "confirmBeforeCreate", label: "Confirm before creating a note", value: source.shouldConfirmBeforeCreate });
	}
	if (source.showWeeklyNote !== undefined) {
		incoming.push({ id: "showWeekNumbers", label: "Show week numbers", value: source.showWeeklyNote });
	}
	if (source.wordsPerDot !== undefined) {
		if (isWordsPerDot(source.wordsPerDot)) {
			incoming.push({ id: "wordsPerDot", label: "Words per dot", value: source.wordsPerDot });
		} else {
			unmapped.push({
				label: "Words per dot",
				value: String(source.wordsPerDot),
				reason: "Calendaric needs a whole number above zero",
			});
		}
	}
	const locale = text(source.localeOverride);
	if (locale !== undefined) {
		// The Calendar plugin's "system-default" is what Calendaric stores as no override.
		if (locale === "system-default") incoming.push({ id: "overrideLocale", label: "Locale override", value: "" });
		else if (locales === undefined || locales.includes(locale)) {
			incoming.push({ id: "overrideLocale", label: "Locale override", value: locale });
		} else unmapped.push({ label: "Locale override", value: locale, reason: "not a locale this Obsidian knows" });
	}

	if (weekFromCalendar) {
		const week: Incoming[] = [];
		// Untrimmed, as getWeeklyNoteSettings() hands it to the Calendar plugin: a
		// trimmed format would name different files than the notes it already made.
		const format = text(source.weeklyNoteFormat) === undefined ? undefined : source.weeklyNoteFormat;
		const folder = text(source.weeklyNoteFolder);
		const template = text(source.weeklyNoteTemplate);
		if (format !== undefined) week.push({ id: "week.format", label: "Weekly note format", value: format });
		if (folder !== undefined) week.push({ id: "week.folder", label: "Weekly note folder", value: folder });
		if (template !== undefined) week.push({ id: "week.templatePath", label: "Weekly note template", value: template });
		if (week.length > 0) incoming.push({ id: "week.enabled", label: "Weekly notes", value: true }, ...week);
	}

	return { incoming, unmapped };
}

function read(target: CalendaricSettings, id: CalendarImportFieldId): string | number | boolean | undefined {
	switch (id) {
		case "week.enabled":
			return target.week.enabled;
		case "week.format":
			return target.week.format;
		case "week.folder":
			return target.week.folder;
		case "week.templatePath":
			return target.week.templatePath;
		default:
			return target[id];
	}
}

function write(target: CalendaricSettings, field: CalendarImportField): void {
	const { id, value } = field;
	if (id === "week.enabled") target.week.enabled = value === true;
	else if (id === "week.format" || id === "week.folder" || id === "week.templatePath") {
		target.week[id.slice("week.".length) as "format" | "folder" | "templatePath"] = String(value);
	} else if (id === "confirmBeforeCreate" || id === "showWeekNumbers") target[id] = value === true;
	else if (id === "wordsPerDot") target.wordsPerDot = Number(value);
	else if (id === "weekStart") target.weekStart = value as CalendaricSettings["weekStart"];
	else target.overrideLocale = String(value);
}

function show(value: string | number | boolean | undefined): string {
	if (typeof value === "boolean") return value ? "on" : "off";
	return value === undefined ? "" : String(value);
}

function plan(incoming: Incoming[], unmapped: CalendarUnmappedValue[], target: CalendaricSettings): CalendarImportPlan {
	const result: CalendarImportPlan = { changes: [], conflicts: [], unmapped };
	for (const entry of incoming) {
		const current = read(target, entry.id);
		if (current === entry.value) continue;
		const field: CalendarImportField = { ...entry, current: show(current), incoming: show(entry.value) };
		// AC-MIG-03.5: only a week text field the user filled in is theirs to keep.
		const customised = entry.id.startsWith("week.") && entry.id !== "week.enabled" && current !== "";
		(customised ? result.conflicts : result.changes).push(field);
	}
	return result;
}

/** A switch, not a comparison, because AC-ARCH-01.5 reads `=== "<plugin id>"` as a plugin lookup. */
function weekFromCalendar(week: ImportSource): boolean {
	switch (week.source) {
		case "periodic-notes":
			return false;
		default:
			return true;
	}
}

/**
 * What the settings tab shows for the Calendar plugin.
 *
 * Offered whenever the plugin carries a value the import reads (AC-MIG-03.7),
 * even when Calendaric already holds every one of them: the criterion asks
 * about the source, and a fresh Calendaric's defaults equal the Calendar
 * plugin's common values.
 */
export function decideCalendarImportCard(
	ports: CalendarImportPorts,
	target: CalendaricSettings,
	locales?: readonly string[],
): CalendarImportCard {
	const source = ports.calendar.readCalendarSettings();
	if (!source.ok) {
		// AC-MIG-03.6: the registry answers for enabled plugins only, so
		// "not installed" and "not enabled" both arrive as absent.
		return source.reason === "absent" ? { kind: "hidden" } : { kind: "unreadable", problem: source.problem };
	}

	const { week } = resolveImportSources(ports.periodicNotes, ports.companion);
	const { incoming, unmapped } = translate(source.value, weekFromCalendar(week), locales);
	if (incoming.length === 0 && unmapped.length === 0) return { kind: "hidden" };
	return { kind: "offer", plan: plan(incoming, unmapped, target) };
}

/**
 * Writes the plan's changes and the conflicts whose ids are in `confirmed`.
 * Returns whether anything changed.
 */
export function applyCalendarImport(
	target: CalendaricSettings,
	importPlan: CalendarImportPlan,
	confirmed: readonly CalendarImportFieldId[],
): boolean {
	const accepted = importPlan.conflicts.filter((field) => confirmed.includes(field.id));
	for (const field of [...importPlan.changes, ...accepted]) write(target, field);
	return importPlan.changes.length + accepted.length > 0;
}
