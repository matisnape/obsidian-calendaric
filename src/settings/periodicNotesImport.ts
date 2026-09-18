import type {
	PeriodicNotesCalendarSet,
	PeriodicNotesGranularityConfig,
	PeriodicNotesPort,
} from "../adapters/companionPluginPort";
import type { Granularity } from "../types";
import { GRANULARITIES } from "./model";

/**
 * The fields the import carries over, in the order the card lists them.
 * `allowPrefixMatch` is on the list by DEC-18, which is what keeps this vault's
 * renamed weekly notes resolving after the switch.
 */
export const PERIODIC_NOTES_IMPORT_KEYS = [
	"enabled",
	"format",
	"folder",
	"templatePath",
	"allowPrefixMatch",
] as const;

export type PeriodicNotesImportKey = (typeof PERIODIC_NOTES_IMPORT_KEYS)[number];

/**
 * One field of one granularity, named once for the whole import.
 *
 * A key alone would not do: the import spans five granularities, so "folder"
 * names five different decisions and a confirmation for one of them would
 * replace all five.
 */
export type PeriodicNotesFieldId = `${Granularity}.${PeriodicNotesImportKey}`;

/** What the import writes to: Calendaric's own per-granularity configuration. */
export type PeriodicNotesImportTarget = Record<
	Granularity,
	{ enabled: boolean; format: string; folder: string; templatePath: string; allowPrefixMatch: boolean }
>;

/**
 * One value the import would change, with the value it would replace.
 *
 * `current` and `incoming` are rendered strings, because their only job is to
 * be shown side by side (AC-MIG-04.4). The value actually written is read back
 * out of the calendar set at apply time, so nothing can be stored in a shape
 * that only looked right on screen.
 */
export interface PeriodicNotesImportField {
	id: PeriodicNotesFieldId;
	granularity: Granularity;
	key: PeriodicNotesImportKey;
	label: string;
	current: string;
	incoming: string;
}

export interface PeriodicNotesImportPlan {
	/** Values Calendaric has not been given yet — imported without asking. */
	additions: PeriodicNotesImportField[];
	/** Values the user set differently — imported only once confirmed. */
	conflicts: PeriodicNotesImportField[];
}

/**
 * What the settings tab shows for Periodic Notes. Every case is a variant, so a
 * plugin whose shape no longer matches cannot fall through to the import path.
 */
export type PeriodicNotesCard =
	| { kind: "hidden" }
	| { kind: "unreadable"; problem: string }
	/** Everything the active set configures is already what Calendaric has. */
	| { kind: "in-sync"; setId: string }
	| { kind: "offer"; set: PeriodicNotesCalendarSet; plan: PeriodicNotesImportPlan };

const FIELD_LABELS: Record<PeriodicNotesImportKey, string> = {
	enabled: "Enabled",
	format: "Format",
	folder: "Note folder",
	templatePath: "Template",
	allowPrefixMatch: "Match a filename that starts with the date",
};

const GRANULARITY_LABELS: Record<Granularity, string> = {
	day: "Daily",
	week: "Weekly",
	month: "Monthly",
	quarter: "Quarterly",
	year: "Yearly",
};

function show(value: string | boolean): string {
	if (typeof value === "boolean") return value ? "on" : "off";
	return value;
}

/** An unset value, per field type. Replacing one takes nothing away from the user. */
function isUnset(value: string | boolean): boolean {
	return value === "" || value === false;
}

/**
 * Which granularities the active calendar set actually configures.
 *
 * A granularity the set does not enable is left out rather than imported as
 * "off": over there it is unconfigured, and turning Calendaric's own copy off to
 * match would delete a setting the user made here, which no criterion asks for.
 */
function importable(set: PeriodicNotesCalendarSet): [Granularity, PeriodicNotesGranularityConfig][] {
	const entries: [Granularity, PeriodicNotesGranularityConfig][] = [];
	for (const granularity of GRANULARITIES) {
		// Keyed by the names Periodic Notes uses, so a name this version does not
		// know simply never matches and is skipped.
		const incoming = set.granularities[granularity];
		if (incoming?.enabled === true) entries.push([granularity, incoming]);
	}
	return entries;
}

/**
 * Every value the import would change, split by whether the user has to be asked.
 *
 * A field whose current value already equals the incoming one is in neither
 * list. That is what makes a repeated import a no-op (AC-MIG-04.5): the second
 * run compares the values it wrote on the first, finds them equal, and produces
 * an empty plan rather than asking about them again.
 */
export function planPeriodicNotesImport(
	set: PeriodicNotesCalendarSet,
	target: PeriodicNotesImportTarget,
): PeriodicNotesImportPlan {
	const plan: PeriodicNotesImportPlan = { additions: [], conflicts: [] };

	for (const [granularity, incoming] of importable(set)) {
		const current = target[granularity];
		for (const key of PERIODIC_NOTES_IMPORT_KEYS) {
			if (current[key] === incoming[key]) continue;
			const field: PeriodicNotesImportField = {
				id: `${granularity}.${key}`,
				granularity,
				key,
				label: `${GRANULARITY_LABELS[granularity]} — ${FIELD_LABELS[key]}`,
				current: show(current[key]),
				incoming: show(incoming[key]),
			};
			if (isUnset(current[key])) plan.additions.push(field);
			else plan.conflicts.push(field);
		}
	}

	return plan;
}

function write(
	target: PeriodicNotesImportTarget,
	field: PeriodicNotesImportField,
	set: PeriodicNotesCalendarSet,
): void {
	const incoming = set.granularities[field.granularity];
	if (incoming === undefined) return;
	const config = target[field.granularity];
	// The two booleans are assigned on their own, because a key union that spans
	// both types would widen the assignment to `string | boolean` on every field.
	if (field.key === "enabled") config.enabled = incoming.enabled;
	else if (field.key === "allowPrefixMatch") config.allowPrefixMatch = incoming.allowPrefixMatch;
	else config[field.key] = incoming[field.key];
}

/**
 * Copies the active calendar set's configuration into Calendaric's own
 * (AC-MIG-04.1). A value the user already set is replaced only when its id is
 * in `confirmed` (AC-MIG-04.4).
 *
 * Returns whether anything changed, which is false for a repeated import of
 * unchanged source data (AC-MIG-04.5).
 */
export function applyPeriodicNotesImport(
	target: PeriodicNotesImportTarget,
	set: PeriodicNotesCalendarSet,
	confirmed: readonly PeriodicNotesFieldId[] = [],
): boolean {
	const plan = planPeriodicNotesImport(set, target);
	const accepted = plan.conflicts.filter((field) => confirmed.includes(field.id));

	for (const field of [...plan.additions, ...accepted]) {
		write(target, field, set);
	}

	return plan.additions.length > 0 || accepted.length > 0;
}

/** The single decision behind the Periodic Notes import card. */
export function decidePeriodicNotesCard(
	periodicNotes: Pick<PeriodicNotesPort, "readActiveCalendarSet">,
	target: PeriodicNotesImportTarget,
): PeriodicNotesCard {
	const read = periodicNotes.readActiveCalendarSet();
	if (!read.ok) {
		// AC-MIG-04.6: Obsidian's plugin registry answers for enabled plugins
		// only, so a plugin that is missing and one the user turned off both
		// arrive here as absence — and neither is worth a banner. A plugin that
		// is there but no longer shaped as this code reads it is the other case:
		// hiding that silently would look like the vault had nothing to migrate.
		return read.reason === "absent" ? { kind: "hidden" } : { kind: "unreadable", problem: read.problem };
	}

	const set = read.value;
	// A set that enables nothing configures nothing, so there is no import to
	// offer and nothing to call already-imported either.
	if (importable(set).length === 0) return { kind: "hidden" };

	const plan = planPeriodicNotesImport(set, target);
	if (plan.additions.length === 0 && plan.conflicts.length === 0) {
		return { kind: "in-sync", setId: set.id };
	}
	return { kind: "offer", set, plan };
}
