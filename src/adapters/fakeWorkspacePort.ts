import type { NoteFile } from "./vaultPort";
import type { LeafMode, WorkspacePort } from "./workspacePort";

/** In-memory WorkspacePort substitute for tests — no running Obsidian required. */
export class FakeWorkspacePort implements WorkspacePort {
	opened: { file: NoteFile; mode: LeafMode }[] = [];

	async openInLeaf(file: NoteFile, mode: LeafMode): Promise<void> {
		this.opened.push({ file, mode });
	}
}
