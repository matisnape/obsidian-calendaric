import type { NoteFile } from "../adapters/vaultPort";
import type { LeafMode, WorkspacePort } from "../adapters/workspacePort";

/**
 * True when the event carries the platform's split modifier.
 * On macOS only Cmd counts: there Ctrl+click is the context-menu gesture,
 * so treating it as a split would steal a right-click.
 */
export function isSplitModifierPressed(event: MouseEvent, isMacOS: boolean): boolean {
	return isMacOS ? event.metaKey : event.ctrlKey;
}

/**
 * Open a periodic note in one of the three destinations, and say so when the
 * note stopped being what sits at its path.
 *
 * `foundAtPath` is where the caller looked the note up, and it is required
 * rather than defaulted. Defaulting it to `file.path` would read the path back
 * off the handle, which a move rewrites in place — a moved note would then open
 * at its new home instead of being reported, and AC-NOTE-06.4 asks for the
 * report. Only the caller that performed the lookup still knows that path.
 */
export async function openNoteIn(
	file: NoteFile,
	mode: LeafMode,
	workspace: WorkspacePort,
	foundAtPath: string,
): Promise<void> {
	const result = await workspace.openInLeaf(file, foundAtPath, mode);
	if (result === "missing") {
		workspace.showNotice(`Could not open "${foundAtPath}" — the file no longer exists at that path.`);
	}
}

/**
 * Open a periodic note from a user click.
 * - Plain click: reuse — reuses the active unpinned tab
 * - Split modifier: split — opens a new pane beside the current view
 */
export async function openNote(file: NoteFile, event: MouseEvent, workspace: WorkspacePort): Promise<void> {
	const mode = isSplitModifierPressed(event, workspace.isMacOS) ? "split" : "reuse";
	// This entry point is handed an already-resolved file and never sees the
	// lookup path, so it can only offer the handle's own. A note that moved
	// before the click therefore still opens; see openNoteIn.
	await openNoteIn(file, mode, workspace, file.path);
}

/**
 * Open a periodic note in a new tab (used for "Open on startup"), which leaves
 * whatever the user had open where it was.
 */
export async function openNoteInNewTab(file: NoteFile, workspace: WorkspacePort): Promise<void> {
	// Same limit as openNote: no lookup path reaches here.
	await openNoteIn(file, "tab", workspace, file.path);
}
