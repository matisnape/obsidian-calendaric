import type { NoteFile } from "./vaultPort";

/** Where a note lands: the active pane, a new split next to it, or a new tab. */
export type LeafMode = "reuse" | "split" | "tab";

/** "missing" means the path stopped resolving between being found and being opened. */
export type OpenResult = "opened" | "missing";

export interface WorkspacePort {
	/**
	 * Which modifier splits: Cmd on macOS, Ctrl elsewhere. It lives on the port
	 * because the platform is host knowledge, and only the adapter talks to the host.
	 */
	readonly isMacOS: boolean;
	openInLeaf(file: NoteFile, mode: LeafMode): Promise<OpenResult>;
	/**
	 * Notices ride this port rather than a port of their own: opening is the only
	 * flow that reports to the user, and one method does not earn three more files.
	 */
	showNotice(message: string): void;
}
