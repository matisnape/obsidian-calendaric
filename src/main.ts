import { Plugin } from "obsidian";
import { CalendaricSettings, CalendaricSettingsTab, DEFAULT_SETTINGS } from "./settings";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./ui/CalendarView";


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

		this.app.workspace.onLayoutReady(() => this.initLeaf());

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
		rightLeaf.setViewState({ type: VIEW_TYPE_CALENDAR });
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
