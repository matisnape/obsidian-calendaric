import type { App, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_CALENDAR } from "../ui/viewType";
import type { CalendarLeafHandle, CalendarLeafPort } from "./calendarLeafPort";

/** Wires one calendar leaf to the real Obsidian Workspace API. */
export class ObsidianCalendarLeaf implements CalendarLeafHandle {
	constructor(private app: App, private leaf: WorkspaceLeaf) {}

	isVisible(): boolean {
		// isShown() is the only public API that sees a leaf sitting behind
		// another tab in the same dock: it reports false for an element any
		// ancestor has hidden with display:none.
		if (!this.leaf.view.containerEl.isShown()) return false;

		// A collapsed sidedock is documented state rather than inferred
		// rendering, so it is checked as well and the two must agree.
		const { leftSplit, rightSplit } = this.app.workspace;
		const root = this.leaf.getRoot();
		if (root === leftSplit) return !leftSplit.collapsed;
		if (root === rightSplit) return !rightSplit.collapsed;

		// A leaf in the editor area has no sidebar to collapse.
		return true;
	}

	async reveal(): Promise<void> {
		await this.app.workspace.revealLeaf(this.leaf);
	}

	focus(): void {
		// revealLeaf brings the leaf forward but leaves the keyboard where it
		// was, so the focus half of the story needs this second call.
		this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
	}

	detach(): void {
		this.leaf.detach();
	}
}

/** Wires CalendarLeafPort to the real Obsidian Workspace API. */
export class ObsidianCalendarLeafAdapter implements CalendarLeafPort {
	constructor(private app: App) {}

	find(): CalendarLeafHandle | null {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];
		return leaf ? new ObsidianCalendarLeaf(this.app, leaf) : null;
	}

	async create(): Promise<CalendarLeafHandle> {
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) throw new Error("Obsidian returned no leaf for the right sidebar");

		try {
			await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
		} catch (error) {
			// getRightLeaf has already attached the leaf, and the caller never
			// received a handle for it, so this is the only place that can
			// remove the half-built pane.
			leaf.detach();
			throw error;
		}

		return new ObsidianCalendarLeaf(this.app, leaf);
	}
}
