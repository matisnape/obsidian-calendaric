import type { App } from "obsidian";
import { VIEW_TYPE_CALENDAR } from "../ui/CalendarView";
import type { CalendarLeafPort } from "./calendarLeafPort";

/** Wires CalendarLeafPort to the real Obsidian Workspace API. */
export class ObsidianCalendarLeafAdapter implements CalendarLeafPort {
	constructor(private app: App) {}

	hasLeaf(): boolean {
		return this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length > 0;
	}

	isVisible(): boolean {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];
		if (!leaf) return false;

		// A sidebar leaf reports the sidedock as its root, and a collapsed
		// sidedock hides everything inside it.
		const { leftSplit, rightSplit } = this.app.workspace;
		const root = leaf.getRoot();
		if (root === leftSplit) return !leftSplit.collapsed;
		if (root === rightSplit) return !rightSplit.collapsed;

		// A leaf in the editor area has no sidebar to collapse.
		return true;
	}

	async create(): Promise<void> {
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) throw new Error("Obsidian returned no leaf for the right sidebar");
		await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
	}

	async reveal(): Promise<void> {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];
		if (!leaf) throw new Error("No calendar leaf to reveal");
		await this.app.workspace.revealLeaf(leaf);
	}

	discard(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_CALENDAR);
	}
}
