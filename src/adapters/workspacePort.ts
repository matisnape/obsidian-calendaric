import type { NoteFile } from "./vaultPort";

export type LeafMode = "reuse" | "split" | "tab";

export interface WorkspacePort {
	openInLeaf(file: NoteFile, mode: LeafMode): Promise<void>;
}
