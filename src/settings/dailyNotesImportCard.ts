import { Notice } from "obsidian";
import {
	decideDailyNotesCard,
	planDailyNotesImport,
	applyDailyNotesImport,
} from "./dailyNotesImport";
import type { DailyNotesImportKey, LegacyDailyNoteSettings } from "./dailyNotesImport";
import { DailyNotesImportConflictModal } from "./dailyNotesImportModal";
import type { CompanionPluginPort } from "../adapters/companionPluginPort";
import type CalendaricPlugin from "../main";

/** What the card needs back from the settings tab that owns it. */
export interface DailyNotesImportCardActions {
	/** Persists the settings and tells the plugin they changed. */
	save: () => Promise<void>;
	/** Re-renders the settings tab. */
	refresh: () => void;
}

/**
 * The Daily Notes import card. Every branch the companion plugin can put the
 * tab in is decided by decideDailyNotesCard, so this module only draws.
 */
export function renderDailyNotesImportCard(
	containerEl: HTMLElement,
	plugin: CalendaricPlugin,
	companion: CompanionPluginPort,
	actions: DailyNotesImportCardActions,
): void {
	const card = decideDailyNotesCard(companion, plugin.settings);

	// AC-MIG-01.6: no banner at all while the core plugin is absent or off.
	if (card.kind === "hidden") return;

	if (card.kind === "unreadable") {
		renderUnreadableNotice(containerEl, card.problem);
		return;
	}

	if (card.kind === "still-active") {
		renderStillActiveNotice(containerEl, card.disable, actions);
		return;
	}

	renderOffer(containerEl, plugin, card.legacy, card.disable, actions);
}

/**
 * AC-ARCH-04.4: the companion plugin is there but its object is not what this
 * code reads. The import is withdrawn and named as broken, because running it
 * would store empty values while looking like it succeeded.
 */
function renderUnreadableNotice(containerEl: HTMLElement, problem: string): void {
	const notice = containerEl.createDiv({ cls: "calendaric-callout calendaric-callout--warning" });
	notice.createEl("strong", { text: "Daily Notes settings could not be read" });
	notice.createEl("p", {
		text: `${problem} Calendaric cannot import them, so enter the format, folder and template below by hand.`,
	});
}

// AC-MIG-01.4: the import banner is replaced by this notice once it ran.
function renderStillActiveNotice(
	containerEl: HTMLElement,
	disableCompanion: () => void,
	actions: DailyNotesImportCardActions,
): void {
	const notice = containerEl.createDiv({ cls: "calendaric-callout calendaric-callout--info" });
	notice.createEl("strong", { text: "Daily Notes plugin is still active" });
	notice.createEl("p", {
		text: "Both plugins may create daily notes. Consider disabling the core Daily Notes plugin.",
	});
	const buttons = notice.createDiv({ cls: "calendaric-callout__buttons" });
	const disableBtn = buttons.createEl("button", { text: "Disable Daily Notes", cls: "mod-cta" });
	disableBtn.addEventListener("click", async () => {
		disableCompanion();
		await actions.save();
		actions.refresh();
	});
	const dismissBtn = buttons.createEl("button", { text: "Dismiss" });
	dismissBtn.addEventListener("click", () => {
		notice.remove();
	});
}

function renderOffer(
	containerEl: HTMLElement,
	plugin: CalendaricPlugin,
	legacy: LegacyDailyNoteSettings,
	disableCompanion: () => void,
	actions: DailyNotesImportCardActions,
): void {
	const { app, settings } = plugin;
	const card = containerEl.createDiv({ cls: "calendaric-callout calendaric-callout--info" });
	card.createEl("strong", { text: "Daily Notes plugin detected" });
	card.createEl("p", {
		text: "Calendaric can import your existing Daily Notes settings (format, folder, template). After import, you can disable the core Daily Notes plugin.",
	});

	const buttons = card.createDiv({ cls: "calendaric-callout__buttons" });

	const importBtn = buttons.createEl("button", { text: "Import settings", cls: "mod-cta" });
	importBtn.addEventListener("click", async () => {
		const applyAndSaveImport = async (confirmed: DailyNotesImportKey[]) => {
			const previousDay = { ...settings.day };
			const previouslyMigrated = settings.hasMigratedDailyNoteSettings;
			applyDailyNotesImport(settings, legacy, confirmed);
			try {
				// Only the write to disk is rolled back; a failed refresh must not undo a stored import.
				await plugin.saveSettings();
			} catch (error) {
				Object.assign(settings.day, previousDay);
				settings.hasMigratedDailyNoteSettings = previouslyMigrated;
				console.error("Calendaric: the Daily Notes import could not be saved", error);
				new Notice("Could not save the Daily Notes import.");
				return;
			}
			plugin.onSettingsChange();
			actions.refresh();
		};

		const plan = planDailyNotesImport(legacy, settings.day);
		if (plan.conflicts.length === 0) {
			await applyAndSaveImport([]);
			return;
		}
		new DailyNotesImportConflictModal(app, plan.conflicts, applyAndSaveImport).open();
	});

	const disableBtn = buttons.createEl("button", { text: "Disable Daily Notes plugin" });
	disableBtn.addEventListener("click", async () => {
		disableCompanion();
		settings.hasMigratedDailyNoteSettings = true;
		await actions.save();
		actions.refresh();
	});

	const dismissBtn = buttons.createEl("button", { text: "Dismiss" });
	dismissBtn.addEventListener("click", async () => {
		settings.hasMigratedDailyNoteSettings = true;
		await actions.save();
		actions.refresh();
	});
}
