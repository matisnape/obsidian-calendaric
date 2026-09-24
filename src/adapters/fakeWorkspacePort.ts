import type { NoteFile } from "./vaultPort";
import type { LeafMode, OpenResult, WorkspacePort } from "./workspacePort";

/** In-memory WorkspacePort substitute for tests — no running Obsidian required. */
export class FakeWorkspacePort implements WorkspacePort {
	opened: { file: NoteFile; mode: LeafMode }[] = [];
	foundPaths: string[] = [];
	notices: string[] = [];
	fileMenus: { file: NoteFile; event: MouseEvent; source: string }[] = [];
	isMacOS = false;
	/** Runs inside openInLeaf, to stand in for the vault changing mid-open. */
	onOpen: (() => void) | null = null;
	private missing = new Set<string>();

	/**
	 * Stands in for every way a path stops holding the note that was found:
	 * deleted, moved away, or taken over by another file. The adapter test is
	 * what separates those; here they are one outcome.
	 */
	markMissing(path: string): void {
		this.missing.add(path);
	}

	/**
	 * Mirrors an Obsidian move: the path is rewritten on the handle itself, and
	 * the path the note was found at stops holding it. Both halves matter — a
	 * fake that only rewrote the handle would let a lookup follow the note.
	 */
	markMoved(file: NoteFile, newPath: string): void {
		this.missing.add(file.path);
		file.path = newPath;
	}

	async openInLeaf(file: NoteFile, foundAtPath: string, mode: LeafMode): Promise<OpenResult> {
		this.foundPaths.push(foundAtPath);
		this.onOpen?.();
		if (this.missing.has(foundAtPath)) return "missing";
		this.opened.push({ file, mode });
		return "opened";
	}

	showNotice(message: string): void {
		this.notices.push(message);
	}

	showFileMenu(file: NoteFile, event: MouseEvent, source: string): void {
		this.fileMenus.push({ file, event, source });
	}
}
