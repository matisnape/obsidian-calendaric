import { Plugin } from "obsidian";
import { CalendaricSettings, DEFAULT_SETTINGS } from "./settings";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./ui/CalendarView";

export default class CalendaricPlugin extends Plugin {
	settings: CalendaricSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf, this));

		this.app.workspace.onLayoutReady(() => {
			this.activateView();
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

	async activateView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			await rightLeaf.setViewState({
				type: VIEW_TYPE_CALENDAR,
				active: true,
			});
			leaf = rightLeaf;
		}

		workspace.revealLeaf(leaf);
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
