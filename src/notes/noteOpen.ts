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
 * `foundAtPath` is where the caller found the note. It defaults to the path the
 * file carries now, which is right whenever the caller resolved it moments ago.
 * A caller holding a note across a longer gap should pass the path it looked at,
 * because a move rewrites `file.path` on the object itself.
 */
export async function openNoteIn(
	file: NoteFile,
	mode: LeafMode,
	workspace: WorkspacePort,
	foundAtPath: string = file.path,
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
	await openNoteIn(file, mode, workspace);
}

/**
 * Open a periodic note in a new tab (used for "Open on startup"), which leaves
 * whatever the user had open where it was.
 */
export async function openNoteInNewTab(file: NoteFile, workspace: WorkspacePort): Promise<void> {
	await openNoteIn(file, "tab", workspace);
}
