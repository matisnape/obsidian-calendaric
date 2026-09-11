import type { NoteFile } from "../adapters/vaultPort";
import type { WorkspacePort } from "../adapters/workspacePort";

/**
 * Returns true if the platform meta key is pressed.
 * macOS: Cmd (metaKey), others: Ctrl (ctrlKey).
 */
export function isMetaPressed(event: MouseEvent): boolean {
	return event.metaKey || event.ctrlKey;
}

/**
 * Open a periodic note in the appropriate leaf.
 * - Normal click: reuse — reuses an existing unpinned tab
 * - Meta/Ctrl click: split — opens in a new split pane
 */
export async function openNote(file: NoteFile, event: MouseEvent, workspace: WorkspacePort): Promise<void> {
	const mode = isMetaPressed(event) ? "split" : "reuse";
	await workspace.openInLeaf(file, mode);
}

/**
 * Open a periodic note in a new tab (used for "Open on startup").
 */
export async function openNoteInNewTab(file: NoteFile, workspace: WorkspacePort): Promise<void> {
	await workspace.openInLeaf(file, "tab");
}
