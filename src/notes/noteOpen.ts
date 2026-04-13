import type { App, TFile } from "obsidian";

/**
 * Returns true if the platform meta key is pressed.
 * macOS: Cmd (metaKey), others: Ctrl (ctrlKey).
 */
export function isMetaPressed(event: MouseEvent): boolean {
	return event.metaKey || event.ctrlKey;
}

/**
 * Open a periodic note in the appropriate leaf.
 * - Normal click: workspace.getLeaf(false) — reuses an existing unpinned tab
 * - Meta/Ctrl click: workspace.getLeaf("split") — opens in a new split pane
 */
export async function openNote(file: TFile, event: MouseEvent, app: App): Promise<void> {
	const { workspace } = app;
	const leaf = isMetaPressed(event)
		? workspace.getLeaf("split")
		: workspace.getLeaf(false);
	await leaf.openFile(file);
}

/**
 * Open a periodic note in a new tab (used for "Open on startup").
 */
export async function openNoteInNewTab(file: TFile, app: App): Promise<void> {
	const leaf = app.workspace.getLeaf("tab");
	await leaf.openFile(file);
}
