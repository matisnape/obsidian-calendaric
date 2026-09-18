import { Notice } from "obsidian";
import { applyPeriodicNotesImport, decidePeriodicNotesCard } from "./periodicNotesImport";
import type {
	PeriodicNotesCalendarSet,
	PeriodicNotesPort,
} from "../adapters/companionPluginPort";
import type { PeriodicNotesFieldId, PeriodicNotesImportPlan } from "./periodicNotesImport";
import { PeriodicNotesImportConflictModal } from "./periodicNotesImportModal";
import { GRANULARITIES } from "./model";
import type CalendaricPlugin from "../main";

/** What the card needs back from the settings tab that owns it. */
export interface PeriodicNotesImportCardActions {
	/** Persists the settings and tells the plugin they changed. */
	save: () => Promise<void>;
	/** Re-renders the settings tab. */
	refresh: () => void;
}

/**
 * The Periodic Notes import card. Every branch the companion plugin can put the
 * tab in is decided by decidePeriodicNotesCard, so this module only draws.
 */
export function renderPeriodicNotesImportCard(
	containerEl: HTMLElement,
	plugin: CalendaricPlugin,
	periodicNotes: Pick<PeriodicNotesPort, "readActiveCalendarSet">,
	actions: PeriodicNotesImportCardActions,
): void {
	const card = decidePeriodicNotesCard(periodicNotes, plugin.settings);

	// AC-MIG-04.6: no banner at all while Periodic Notes is absent or disabled.
	if (card.kind === "hidden") return;

	if (card.kind === "unreadable") {
		const notice = containerEl.createDiv({ cls: "calendaric-callout calendaric-callout--warning" });
		notice.createEl("strong", { text: "Periodic notes settings could not be read" });
		notice.createEl("p", {
			text: `${card.problem} Calendaric cannot import them, so enter each granularity's format, folder and template below by hand.`,
		});
		return;
	}

	if (card.kind === "in-sync") {
		// AC-MIG-04.5: the import already ran against this configuration. Saying
		// so is what keeps a second run from looking like work left undone.
		const notice = containerEl.createDiv({ cls: "calendaric-callout calendaric-callout--info" });
		notice.createEl("strong", { text: "Periodic notes settings already imported" });
		notice.createEl("p", {
			text: `Calendaric already matches the "${card.setId}" calendar set. There is nothing left to import.`,
		});
		return;
	}

	renderOffer(containerEl, plugin, card.set, card.plan, actions);
}

function renderOffer(
	containerEl: HTMLElement,
	plugin: CalendaricPlugin,
	set: PeriodicNotesCalendarSet,
	plan: PeriodicNotesImportPlan,
	actions: PeriodicNotesImportCardActions,
): void {
	const { app, settings } = plugin;
	const card = containerEl.createDiv({ cls: "calendaric-callout calendaric-callout--info" });
	card.createEl("strong", { text: "Periodic notes plugin detected" });
	card.createEl("p", {
		text: `Calendaric can import the enabled/format/folder/template settings from your active "${set.id}" calendar set. Its other calendar sets are left alone.`,
	});

	const summary = card.createEl("ul");
	for (const field of [...plan.additions, ...plan.conflicts]) {
		summary.createEl("li", { text: `${field.label}: "${field.current}" → "${field.incoming}"` });
	}

	const confirm = async (confirmed: PeriodicNotesFieldId[]) => {
		const previous = GRANULARITIES.map((granularity) => [granularity, { ...settings[granularity] }] as const);
		applyPeriodicNotesImport(settings, set, confirmed);
		try {
			// Only the write to disk is rolled back; a failed refresh must not undo a stored import.
			await plugin.saveSettings();
		} catch (error) {
			for (const [granularity, config] of previous) Object.assign(settings[granularity], config);
			console.error("Calendaric: the Periodic Notes import could not be saved", error);
			new Notice("Periodic notes import could not be saved.");
			return;
		}
		plugin.onSettingsChange();
		actions.refresh();
	};

	const buttons = card.createDiv({ cls: "calendaric-callout__buttons" });
	const importBtn = buttons.createEl("button", { text: "Import settings", cls: "mod-cta" });
	// The listener stays synchronous and voids the promise, the way this plugin's
	// other click handlers do (src/ui/calendar.ts:86): an async listener hands a
	// promise to an API whose return type is void, and nothing awaits it.
	importBtn.addEventListener("click", () => {
		if (plan.conflicts.length === 0) {
			void confirm([]);
			return;
		}
		new PeriodicNotesImportConflictModal(app, plan.conflicts, confirm).open();
	});
}
