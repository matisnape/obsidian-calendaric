import type { NoteFile } from "./vaultPort";
import type { LeafMode, OpenResult, WorkspacePort } from "./workspacePort";

/** In-memory WorkspacePort substitute for tests — no running Obsidian required. */
export class FakeWorkspacePort implements WorkspacePort {
	opened: { file: NoteFile; mode: LeafMode }[] = [];
	notices: string[] = [];
	isMacOS = false;
	private missing = new Set<string>();

	/** Stands in for a file deleted or moved after it was resolved. */
	markMissing(path: string): void {
		this.missing.add(path);
	}

	async openInLeaf(file: NoteFile, mode: LeafMode): Promise<OpenResult> {
		if (this.missing.has(file.path)) return "missing";
		this.opened.push({ file, mode });
		return "opened";
	}

	showNotice(message: string): void {
		this.notices.push(message);
	}
}
