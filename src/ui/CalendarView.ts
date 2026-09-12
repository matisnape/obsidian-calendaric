import { ItemView, WorkspaceLeaf } from "obsidian";
import type CalendaricPlugin from "../main";
import type { CalendarDeps } from "../adapters/calendarDeps";
import { CalendarWidget } from "./calendar";
import { VIEW_TYPE_CALENDAR } from "./viewType";

export class CalendarView extends ItemView {
	private calendar: CalendarWidget | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: CalendaricPlugin,
		private deps: CalendarDeps,
	) {
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

		this.calendar = new CalendarWidget(container, this.app, this.plugin.settings, this.deps);

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
