import { Notice, Platform, TFile } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import type { NoteFile } from "./vaultPort";
import type { LeafMode, OpenResult, WorkspacePort } from "./workspacePort";

/** Wires WorkspacePort to the real Obsidian Workspace API. */
export class ObsidianWorkspaceAdapter implements WorkspacePort {
	readonly isMacOS = Platform.isMacOS;

	constructor(private app: App) {}

	async openInLeaf(file: NoteFile, mode: LeafMode): Promise<OpenResult> {
		// The handle can outlive the file it points at, so the path is resolved
		// again here. A stale handle would otherwise open a file that moved away.
		const resolved = this.app.vault.getAbstractFileByPath(file.path);
		if (!(resolved instanceof TFile)) return "missing";

		await this.leafFor(mode).openFile(resolved);
		return "opened";
	}

	showNotice(message: string): void {
		new Notice(message);
	}

	private leafFor(mode: LeafMode): WorkspaceLeaf {
		if (mode === "split") return this.app.workspace.getLeaf("split");
		if (mode === "tab") return this.app.workspace.getLeaf("tab");
		// getLeaf(false) is Obsidian's replacement for the deprecated
		// getUnpinnedLeaf(): it reuses the active tab unless that tab is pinned.
		return this.app.workspace.getLeaf(false);
	}
}
