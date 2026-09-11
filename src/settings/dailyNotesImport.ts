import type { CompanionPluginPort } from "../adapters/companionPluginPort";

/** Documented default used when the core plugin stored no format (AC-MIG-01.3). */
export const DEFAULT_DAY_FORMAT = "YYYY-MM-DD";

export type DailyNotesImportKey = "format" | "folder" | "templatePath";

export interface LegacyDailyNoteSettings {
	format: string;
	folder: string;
	template: string;
}

/** The slice of the plugin settings the import writes to. */
export interface DailyNotesImportTarget {
	hasMigratedDailyNoteSettings: boolean;
	day: {
		enabled: boolean;
		format: string;
		folder: string;
		templatePath: string;
	};
}

export interface DailyNotesImportField {
	key: DailyNotesImportKey;
	label: string;
	current: string;
	incoming: string;
}

export interface DailyNotesImportPlan {
	/** Fields the user has not filled in yet — imported without asking. */
	additions: DailyNotesImportField[];
	/** Fields the user already filled differently — imported only once confirmed. */
	conflicts: DailyNotesImportField[];
}

const FIELD_LABELS: Record<DailyNotesImportKey, string> = {
	format: "Format",
	folder: "Note folder",
	templatePath: "Template",
};

/**
 * What the settings tab shows for the companion plugin. Every case the tab can
 * face is a variant here, so a companion plugin whose shape no longer matches
 * cannot fall through to the import path (AC-ARCH-04.4).
 */
export type DailyNotesCard =
	| { kind: "hidden" }
	| { kind: "unreadable"; problem: string }
	| { kind: "offer"; legacy: LegacyDailyNoteSettings }
	| { kind: "still-active" };

/** The single decision behind the import card (AC-MIG-01.1, .4, .6). */
export function decideDailyNotesCard(
	companion: CompanionPluginPort,
	target: DailyNotesImportTarget,
): DailyNotesCard {
	const read = companion.readDailyNotes();
	if (!read.ok) {
		// A plugin the user never installed is not a problem worth reporting.
		return read.reason === "absent" ? { kind: "hidden" } : { kind: "unreadable", problem: read.problem };
	}

	const state = read.value;
	if (!state.enabled) return { kind: "hidden" };

	const { format, folder, template } = state;
	if (target.hasMigratedDailyNoteSettings) return { kind: "still-active" };
	return { kind: "offer", legacy: { format, folder, template } };
}

export function planDailyNotesImport(
	legacy: LegacyDailyNoteSettings,
	day: DailyNotesImportTarget["day"],
): DailyNotesImportPlan {
	const incoming: Record<DailyNotesImportKey, string> = {
		format: legacy.format !== "" ? legacy.format : DEFAULT_DAY_FORMAT,
		folder: legacy.folder,
		templatePath: legacy.template,
	};

	const plan: DailyNotesImportPlan = { additions: [], conflicts: [] };
	for (const key of ["format", "folder", "templatePath"] as const) {
		const field = { key, label: FIELD_LABELS[key], current: day[key], incoming: incoming[key] };
		if (field.current === field.incoming) continue;
		if (field.current === "") plan.additions.push(field);
		else plan.conflicts.push(field);
	}
	return plan;
}

/**
 * Copies the core Daily Notes configuration into the day config (AC-MIG-01.2).
 * A conflicting value is replaced only when its key is in `confirmed` (AC-MIG-01.5).
 * Returns false and changes nothing when the import already ran (AC-MIG-01.4).
 */
export function applyDailyNotesImport(
	target: DailyNotesImportTarget,
	legacy: LegacyDailyNoteSettings,
	confirmed: readonly DailyNotesImportKey[] = [],
): boolean {
	if (target.hasMigratedDailyNoteSettings) return false;

	const plan = planDailyNotesImport(legacy, target.day);
	for (const field of plan.additions) {
		target.day[field.key] = field.incoming;
	}
	for (const field of plan.conflicts) {
		if (confirmed.includes(field.key)) target.day[field.key] = field.incoming;
	}
	target.day.enabled = true;
	target.hasMigratedDailyNoteSettings = true;
	return true;
}
