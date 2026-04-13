import { Plugin, TFile } from "obsidian";
import { CalendaricSettings, CalendaricSettingsTab, DEFAULT_SETTINGS } from "./settings";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./ui/CalendarView";
import { computeNotePath } from "./notes/noteUtils";
import { createNote } from "./notes/noteCreate";
import { openNoteInNewTab } from "./notes/noteOpen";


export default class CalendaricPlugin extends Plugin {
	settings: CalendaricSettings;

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

		this.addCommand({
			id: "show-calendar-view",
			name: "Show calendar",
			callback: () => this.activateView(),
		});
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

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			await rightLeaf.setViewState({ type: VIEW_TYPE_CALENDAR });
			leaf = rightLeaf;
		}

		workspace.revealLeaf(leaf);
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
			const path = computeNotePath(date, config, this.app);
			const existing = this.app.vault.getAbstractFileByPath(path);

			let file: TFile;
			if (existing instanceof TFile) {
				file = existing;
			} else {
				// Create silently — bypass confirmBeforeCreate on startup
				// Only day/week notes are supported for creation; month/quarter/year are not yet implemented
				if (key !== "day" && key !== "week") break;
				file = await createNote(date, key, config, this.app);
			}

			await openNoteInNewTab(file, this.app);
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
