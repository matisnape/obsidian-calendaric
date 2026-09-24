import { Menu, Notice, Platform, TFile } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import type { NoteFile } from "./vaultPort";
import type { LeafMode, OpenResult, WorkspacePort } from "./workspacePort";
import { HOVER_LINK_SOURCE } from "../ui/cellActions";

/** Wires WorkspacePort to the real Obsidian Workspace API. */
export class ObsidianWorkspaceAdapter implements WorkspacePort {
	readonly isMacOS = Platform.isMacOS;

	constructor(private app: App) {}

	async openInLeaf(file: NoteFile, foundAtPath: string, mode: LeafMode): Promise<OpenResult> {
		const resolved = this.app.vault.getAbstractFileByPath(foundAtPath);

		// Identity, not the path. Obsidian keeps one object per file and rewrites
		// its path in place on a move, so the path alone answers "is something
		// here?" when the question is "is this still the note that was found?".
		// A delete-then-create at the same path would otherwise open the impostor.
		if (resolved !== file) return "missing";
		if (!(resolved instanceof TFile)) return "missing";

		await this.leafFor(mode).openFile(resolved);
		return "opened";
	}

	showNotice(message: string): void {
		new Notice(message);
	}

	showFileMenu(file: NoteFile, event: MouseEvent): void {
		// `file-menu` hands the menu to Obsidian and every plugin to fill, and
		// they act on a TFile; anything else has no menu to show.
		if (!(file instanceof TFile)) return;
		const menu = new Menu();
		this.app.workspace.trigger("file-menu", menu, file, HOVER_LINK_SOURCE);
		menu.showAtMouseEvent(event);
	}

	private leafFor(mode: LeafMode): WorkspaceLeaf {
		if (mode === "split") return this.app.workspace.getLeaf("split");
		if (mode === "tab") return this.app.workspace.getLeaf("tab");
		// getLeaf(false) is Obsidian's replacement for the deprecated
		// getUnpinnedLeaf(): it reuses the active tab unless that tab is pinned.
		return this.app.workspace.getLeaf(false);
	}
}
