import { Notice } from "obsidian";
import { applyCalendarImport, decideCalendarImportCard } from "./calendarImport";
import type { CalendarImportFieldId, CalendarImportPlan, CalendarImportPorts } from "./calendarImport";
import { CalendarImportConflictModal } from "./calendarImportModal";
import type CalendaricPlugin from "../main";

/** Re-renders the settings tab once an import is stored. */
export interface CalendarImportCardActions {
	refresh: () => void;
}

/** Locale codes the host knows, read through Obsidian's moment; undefined when it has none. */
function knownLocales(): readonly string[] | undefined {
	const { moment } = window as unknown as { moment?: { locales?: () => string[] } };
	return moment?.locales?.();
}

/** The Calendar plugin import card. decideCalendarImportCard decides what it shows; this draws it and stores the choice. */
export function renderCalendarImportCard(
	containerEl: HTMLElement,
	plugin: CalendaricPlugin,
	ports: CalendarImportPorts,
	actions: CalendarImportCardActions,
): void {
	const card = decideCalendarImportCard(ports, plugin.settings, knownLocales());
	if (card.kind === "hidden") return;

	if (card.kind === "unreadable") {
		const notice = containerEl.createDiv({ cls: "calendaric-callout calendaric-callout--warning" });
		notice.createEl("strong", { text: "Calendar plugin settings could not be read" });
		notice.createEl("p", { text: `${card.problem} Calendaric cannot import them, so set them below by hand.` });
		return;
	}

	renderOffer(containerEl, plugin, card.plan, actions);
}

function renderOffer(
	containerEl: HTMLElement,
	plugin: CalendaricPlugin,
	plan: CalendarImportPlan,
	actions: CalendarImportCardActions,
): void {
	const { app, settings } = plugin;
	const card = containerEl.createDiv({ cls: "calendaric-callout calendaric-callout--info" });
	card.createEl("strong", { text: "Calendar plugin detected" });
	card.createEl("p", {
		text: "Calendaric can import its weekly note settings and display preferences. Its own settings stay as they are.",
	});

	const fields = [...plan.changes, ...plan.conflicts];
	const summary = card.createEl("ul");
	for (const field of fields) {
		summary.createEl("li", { text: `${field.label}: "${field.current}" → "${field.incoming}"` });
	}
	for (const entry of plan.unmapped) {
		summary.createEl("li", { text: `${entry.label}: "${entry.value}" is not imported, ${entry.reason}.` });
	}
	// AC-MIG-03.7: still offered when nothing would change, because the offer
	// follows what the Calendar plugin carries, not what Calendaric lacks.
	if (fields.length === 0) card.createEl("p", { text: "Calendaric already has every value it can import." });

	const confirm = async (confirmed: CalendarImportFieldId[]) => {
		const { weekStart, confirmBeforeCreate, showWeekNumbers, wordsPerDot, overrideLocale } = settings;
		const previousWeek = { ...settings.week };
		applyCalendarImport(settings, plan, confirmed);
		try {
			await plugin.saveSettings();
		} catch (error) {
			// Put back in place, so nothing holding `settings.week` sees a stale object.
			Object.assign(settings, { weekStart, confirmBeforeCreate, showWeekNumbers, wordsPerDot, overrideLocale });
			Object.assign(settings.week, previousWeek);
			console.error("Calendaric: the Calendar plugin import could not be saved", error);
			new Notice("Calendar plugin import could not be saved.");
			return;
		}
		plugin.onSettingsChange();
		actions.refresh();
	};

	const importBtn = card.createDiv({ cls: "calendaric-callout__buttons" }).createEl("button", {
		text: "Import settings",
		cls: "mod-cta",
	});
	importBtn.addEventListener("click", () => {
		if (plan.conflicts.length === 0) void confirm([]);
		else new CalendarImportConflictModal(app, plan.conflicts, confirm).open();
	});
}
