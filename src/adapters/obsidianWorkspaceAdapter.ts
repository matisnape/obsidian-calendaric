import { Menu, Notice, Platform, TFile } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import type { NoteFile } from "./vaultPort";
import type { LeafMode, OpenResult, WorkspacePort } from "./workspacePort";

/** Wires WorkspacePort to the real Obsidian Workspace API. */
export class ObsidianWorkspaceAdapter implements WorkspacePort {
	readonly isMacOS = Platform.isMacOS;

	constructor(private app: App) {}

	async openInLeaf(file: NoteFile, foundAtPath: string, mode: LeafMode): Promise<OpenResult> {
		const resolved = this.stillAt(file, foundAtPath);
		if (!resolved) return "missing";

		await this.leafFor(mode).openFile(resolved);
		return "opened";
	}

	async activateIfOpen(file: NoteFile, foundAtPath: string): Promise<boolean> {
		const resolved = this.stillAt(file, foundAtPath);
		if (!resolved) return false;

		// A restored tab stays deferred until shown: it has no `view.file` yet,
		// and only its saved view state names the note. The type check keeps a
		// backlinks or outline pane, whose state also carries a `file`, out.
		const leaves: WorkspaceLeaf[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			leaves.push(leaf);
		});
		const leaf = leaves.find((candidate) => {
			const state = candidate.getViewState();
			return state.type === "markdown" && state.state?.file === resolved.path;
		});
		if (!leaf) return false;

		// revealLeaf loads a deferred leaf before it resolves.
		await this.app.workspace.revealLeaf(leaf);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		return true;
	}

	showNotice(message: string): void {
		new Notice(message);
	}

	showFileMenu(file: NoteFile, event: MouseEvent, source: string): void {
		// Every item acts on a TFile; anything else has no menu to show.
		if (!(file instanceof TFile)) return;
		const menu = new Menu();
		// `file-menu` brings only other plugins' items: the file explorer adds
		// Obsidian's own Delete in its own code. promptForDeletion is that same
		// delete, with the user's confirm and trash settings.
		menu.addItem((item) =>
			item
				.setTitle("Delete")
				.setIcon("trash")
				.onClick(() => void this.app.fileManager.promptForDeletion(file)),
		);
		this.app.workspace.trigger("file-menu", menu, file, source);
		menu.showAtMouseEvent(event);
	}

	/**
	 * Identity, not the path. Obsidian keeps one object per file and rewrites
	 * its path in place on a move, so the path alone answers "is something
	 * here?" when the question is "is this still the note that was found?".
	 * A delete-then-create at the same path would otherwise open the impostor.
	 */
	private stillAt(file: NoteFile, foundAtPath: string): TFile | null {
		const resolved = this.app.vault.getAbstractFileByPath(foundAtPath);
		if (resolved !== file) return null;
		if (!(resolved instanceof TFile)) return null;
		return resolved;
	}

	private leafFor(mode: LeafMode): WorkspaceLeaf {
		if (mode === "split") return this.app.workspace.getLeaf("split");
		if (mode === "tab") return this.app.workspace.getLeaf("tab");
		// getLeaf(false) is Obsidian's replacement for the deprecated
		// getUnpinnedLeaf(): it reuses the active tab unless that tab is pinned.
		return this.app.workspace.getLeaf(false);
	}
}
