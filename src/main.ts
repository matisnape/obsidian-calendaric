import { Notice, Plugin, TFile } from "obsidian";
import { CalendaricSettings, CalendaricSettingsTab, DEFAULT_SETTINGS } from "./settings";
import { CalendarView } from "./ui/CalendarView";
import { VIEW_TYPE_CALENDAR } from "./ui/viewType";
import { computeNotePath } from "./notes/noteUtils";
import { createNote } from "./notes/noteCreate";
import { openNoteInNewTab } from "./notes/noteOpen";
import { ObsidianVaultAdapter } from "./adapters/obsidianVaultAdapter";
import { ObsidianWorkspaceAdapter } from "./adapters/obsidianWorkspaceAdapter";
import { ObsidianVaultConfigAdapter } from "./adapters/obsidianVaultConfigAdapter";
import { ObsidianCalendarLeafAdapter } from "./adapters/obsidianCalendarLeafAdapter";
import { calendarViewCommand, createCalendarOpener } from "./ui/calendarCommand";
import type { NoteFile } from "./adapters/vaultPort";


export default class CalendaricPlugin extends Plugin {
	// Obsidian constructs the plugin before onload() can read the saved data, so
	// the field starts on the defaults rather than on an assertion that it is set.
	settings: CalendaricSettings = { ...DEFAULT_SETTINGS };

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf, this));

		this.addSettingTab(new CalendaricSettingsTab(this.app, this));

		// Apply saved locale override
		if (this.settings.overrideLocale) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(window as any).moment?.locale(this.settings.overrideLocale);
		}

		this.app.workspace.onLayoutReady(() => {
			this.initLeaf();
			void this.openStartupNote();
		});

		const calendarLeaves = new ObsidianCalendarLeafAdapter(this.app);
		// One opener for the whole plugin, so two callers racing to open the
		// calendar share one leaf instead of making two.
		const openCalendar = createCalendarOpener(calendarLeaves, (message) => {
			new Notice(message);
		});
		this.addCommand(calendarViewCommand(calendarLeaves, openCalendar));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_CALENDAR);
	}

	initLeaf(): void {
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length) return;
		const rightLeaf = this.app.workspace.getRightLeaf(false);
		if (!rightLeaf) return;
		void rightLeaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: false });
	}

	onSettingsChange(): void {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];
		if (leaf?.view instanceof CalendarView) {
			leaf.view.refresh();
		}
	}

	private async openStartupNote(): Promise<void> {
		const granularities = ["day", "week", "month", "quarter", "year"] as const;
		for (const key of granularities) {
			const config = this.settings[key];
			if (!config.openAtStartup || !config.enabled) continue;

			const date = window.moment();
			const path = computeNotePath(date, config, new ObsidianVaultConfigAdapter(this.app));
			const existing = this.app.vault.getAbstractFileByPath(path);

			let file: NoteFile;
			if (existing instanceof TFile) {
				file = existing;
			} else {
				// Create silently — bypass confirmBeforeCreate on startup
				// Only day/week notes are supported for creation; month/quarter/year are not yet implemented
				if (key !== "day" && key !== "week") break;
				file = await createNote(path, date, key, config, new ObsidianVaultAdapter(this.app));
			}

			await openNoteInNewTab(file, new ObsidianWorkspaceAdapter(this.app));
			break; // Only one granularity can have openAtStartup (enforced by clearStartupNote)
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData() as Partial<CalendaricSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
