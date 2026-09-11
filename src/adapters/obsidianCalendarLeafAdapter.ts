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
		// revealLeaf only began returning a promise in Obsidian 1.7.2. Awaiting
		// its older void return resolves immediately rather than failing, so
		// this stays safe down to the manifest's minAppVersion; all that is lost
		// on an older host is the guarantee that the view finished loading.
		await this.app.workspace.revealLeaf(this.leaf);
	}

	focus(): void {
		// revealLeaf brings the leaf forward but leaves the keyboard where it
		// was, so the focus half of the story needs this second call.
		//
		// The object form, setActiveLeaf(leaf, { focus: true }), needs Obsidian
		// 0.16.3, and manifest.json declares minAppVersion 0.15.0. On an older
		// host the object would land in the pushHistory slot and focus would
		// never be requested, so AC-CMD-01.1 would not hold on the version the
		// plugin promises to support. This three-argument overload reaches
		// 0.15.0 and still works today, so it is the call that honours the
		// declared floor. Raising minAppVersion instead would drop older
		// installs, which is a support decision rather than this ticket's.
		// eslint-disable-next-line @typescript-eslint/no-deprecated -- reaches manifest.json's declared minAppVersion 0.15.0; the object form needs 0.16.3
		this.app.workspace.setActiveLeaf(this.leaf, false, true);
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

	async create(options: { active: boolean }): Promise<CalendarLeafHandle> {
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) throw new Error("Obsidian returned no leaf for the right sidebar");

		try {
			// active comes from the caller: an active leaf takes focus as soon
			// as it appears, which the palette command wants and startup must
			// not do.
			await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: options.active });
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
