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
import { calendarViewCommand, createCalendarCoordinator } from "./ui/calendarCommand";
import type { NoteFile } from "./adapters/vaultPort";
import { HOVER_LINK_SOURCE } from "./ui/cellActions";


export default class CalendaricPlugin extends Plugin {
	// Obsidian constructs the plugin before onload() can read the saved data, so
	// the field starts on the defaults rather than on an assertion that it is set.
	settings: CalendaricSettings = { ...DEFAULT_SETTINGS };

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf, this));

		this.addSettingTab(new CalendaricSettingsTab(this.app, this));

		// Lets the 'Page preview' plugin list the grid as a hover source and gate it on Mod.
		this.registerHoverLinkSource(HOVER_LINK_SOURCE, {
			display: "Calendaric",
			defaultMod: true,
		});

		// Apply saved locale override
		if (this.settings.overrideLocale) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(window as any).moment?.locale(this.settings.overrideLocale);
		}

		const calendarLeaves = new ObsidianCalendarLeafAdapter(this.app);
		// One coordinator for the whole plugin. Startup and the palette command
		// both reach for the calendar leaf, and they share this creation lock,
		// so neither can make a second one while the other is still creating.
		const calendar = createCalendarCoordinator(calendarLeaves, (message) => {
			new Notice(message);
		});

		this.app.workspace.onLayoutReady(() => {
			// Startup parks the leaf without revealing or focusing it.
			void calendar.ensure();
			void this.openStartupNote();
		});

		this.addCommand(calendarViewCommand(calendarLeaves, calendar.open));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_CALENDAR);
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
				file = await createNote(
					path,
					date,
					key,
					config,
					new ObsidianVaultAdapter(this.app),
					(message) => new Notice(message),
				);
			}

			await openNoteInNewTab(file, new ObsidianWorkspaceAdapter(this.app), path);
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
