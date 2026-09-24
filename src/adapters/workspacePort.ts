import type { NoteFile } from "./vaultPort";

/** Where a note lands: the active pane, a new split next to it, or a new tab. */
export type LeafMode = "reuse" | "split" | "tab";

/**
 * "missing" means the note that was found is not what sits at that path any
 * more — deleted, moved away, or replaced by something else.
 */
export type OpenResult = "opened" | "missing";

export interface WorkspacePort {
	/**
	 * Which modifier splits: Cmd on macOS, Ctrl elsewhere. It lives on the port
	 * because the platform is host knowledge, and only the adapter talks to the host.
	 */
	readonly isMacOS: boolean;
	/**
	 * Opens the note, and only that note.
	 *
	 * `file` must be the vault's own object, not a copy carrying the same path:
	 * the implementation is required to check identity, because a path on its own
	 * cannot tell the note apart from a different file that has since taken its
	 * place. `foundAtPath` is held separately from `file.path` because a move
	 * rewrites the path on the object, so the object stops remembering where the
	 * caller found it.
	 */
	openInLeaf(file: NoteFile, foundAtPath: string, mode: LeafMode): Promise<OpenResult>;
	/**
	 * Notices ride this port rather than a port of their own: opening is the only
	 * flow that reports to the user, and one method does not earn three more files.
	 */
	showNotice(message: string): void;
	/**
	 * Shows the note's own file menu at the event's position: the one a file
	 * explorer row shows, with whatever Obsidian and other plugins add to it.
	 *
	 * Optional so a host without file menus, and every hand-built port, still
	 * type-checks; a caller treats its absence as "no menu here".
	 */
	showFileMenu?(file: NoteFile, event: MouseEvent): void;
}
