import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { NoteFile } from "./vaultPort";
import type { LeafMode, WorkspacePort } from "./workspacePort";

/** Wires WorkspacePort to the real Obsidian Workspace API. */
export class ObsidianWorkspaceAdapter implements WorkspacePort {
	constructor(private app: App) {}

	async openInLeaf(file: NoteFile, mode: LeafMode): Promise<void> {
		if (!(file instanceof TFile)) {
			throw new Error(`Expected a TFile at path: ${file.path}`);
		}
		const leaf =
			mode === "split"
				? this.app.workspace.getLeaf("split")
				: mode === "tab"
					? this.app.workspace.getLeaf("tab")
					: this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}
}
