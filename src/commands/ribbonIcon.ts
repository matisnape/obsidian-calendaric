import type { ReleaseGranularity } from "../types";
import { isReleaseGranularity } from "../types";
import type { LeafMode } from "../adapters/workspacePort";
import type { EnabledSource } from "../settings/model";
import { getActiveGranularities } from "../settings/model";
import { isSplitModifierPressed } from "../notes/noteOpen";
import { commandName } from "./granularityCommands";

/** The Lucide icon the ribbon shows, whichever granularity it stands for. */
export const RIBBON_ICON = "calendar-days";

/**
 * Obsidian keys a ribbon item, and the user's hide and reorder choice for it,
 * by its title, so the title never follows the granularity. The tooltip does.
 */
export const RIBBON_TITLE = "Open current periodic note";

/**
 * Whatever the icon is added to. The plugin satisfies it with its own
 * `addRibbonIcon`, which also removes the icon on unload, and Obsidian's
 * `setTooltip`.
 */
export interface RibbonHost {
	addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => void): HTMLElement;
	setTooltip(el: HTMLElement, tooltip: string): void;
}

/** Opens or creates a granularity's current-period note. Supplied by the plugin. */
export type OpenCurrent = (granularity: ReleaseGranularity, mode: LeafMode) => void;

export interface MenuEntry {
	title: string;
	open: () => void;
}

/** Shows the right-click menu. Supplied by the plugin, which owns Obsidian's `Menu`. */
export type ShowMenu = (entries: MenuEntry[], evt: MouseEvent) => void;

/**
 * One ribbon icon for the first active granularity, with a right-click menu for
 * every active one (US-CMD-08).
 *
 * `sync` runs on load and after every settings change. Clicks read the
 * granularities of the last sync, so the icon always opens what it says.
 */
export class RibbonIcon {
	private el: HTMLElement | null = null;
	private active: ReleaseGranularity[] = [];

	constructor(
		private host: RibbonHost,
		private isMacOS: boolean,
		private open: OpenCurrent,
		private showMenu: ShowMenu,
	) {}

	sync(configs: EnabledSource): void {
		// Quarter is reserved (DEC-23) and is filtered out here, like in the commands (AC-CMD-08.6).
		this.active = getActiveGranularities(configs).filter(isReleaseGranularity);
		const first = this.active[0];
		// ponytail: an icon already shown stays until reload when every granularity
		// is switched off, inert. The public API only removes it on unload; the
		// ribbon re-adds a detached element on its next redraw.
		if (!first) return;

		if (!this.el) {
			this.el = this.host.addRibbonIcon(RIBBON_ICON, RIBBON_TITLE, (evt) => this.onClick(evt));
			this.el.addEventListener("contextmenu", (evt) => this.onContextMenu(evt));
		}
		this.host.setTooltip(this.el, commandName(first, "open-current"));
	}

	private onClick(evt: MouseEvent): void {
		const first = this.active[0];
		// Obsidian also routes `auxclick` here, and a right-click fires one before
		// its `contextmenu`: that button is the menu's, not an open.
		if (!first || evt.button === 2) return;
		this.open(first, isSplitModifierPressed(evt, this.isMacOS) ? "split" : "reuse");
	}

	private onContextMenu(evt: MouseEvent): void {
		if (this.active.length < 2) return;
		evt.preventDefault();
		this.showMenu(
			this.active.map((granularity) => ({
				title: commandName(granularity, "open-current"),
				open: () => this.open(granularity, "reuse"),
			})),
			evt,
		);
	}
}
