import { ItemView, WorkspaceLeaf } from "obsidian";
import type CalendaricPlugin from "../main";
import { CalendarWidget } from "./calendar";

export const VIEW_TYPE_CALENDAR = "calendaric-calendar";

export class CalendarView extends ItemView {
	private calendar: CalendarWidget | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: CalendaricPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_CALENDAR;
	}

	getDisplayText(): string {
		return "Calendar";
	}

	getIcon(): string {
		return "calendar";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("calendaric-view");

		this.calendar = new CalendarWidget(container, this.plugin.settings);

		// Refresh every 60 seconds to catch midnight rollover
		this.registerInterval(
			window.setInterval(() => this.calendar?.refresh(), 60 * 1000)
		);
	}

	async onClose(): Promise<void> {
		this.calendar?.destroy();
		this.calendar = null;
	}

	refresh(): void {
		this.calendar?.refreshSettings(this.plugin.settings);
	}
}
