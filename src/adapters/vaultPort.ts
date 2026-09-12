export interface NoteFile {
	path: string;
}

/**
 * What happened to one file in the vault.
 *
 * `metadata` is not a file change at all: it is the host finishing its read of
 * a file's frontmatter, which lands after the create that produced the file.
 * A consumer that only watched create would miss every frontmatter date.
 */
export type VaultChangeKind = "create" | "delete" | "rename" | "metadata";

export interface VaultChange {
	kind: VaultChangeKind;
	file: NoteFile;
	/** Only a rename carries one: where the file was before it moved. */
	oldPath?: string;
}

/** Obsidian's saved fold state for one file: which line ranges are collapsed. */
export interface FoldState {
	folds: { from: number; to: number }[];
	lines: number;
}

export interface VaultPort {
	/**
	 * The object that stands for the vault behind this port.
	 *
	 * Two ports over one vault must answer the same object: every calendar pane
	 * builds its own adapter, and whatever those adapters coordinate — an
	 * in-flight write, a queue — lands in a single vault.
	 */
	readonly backingVault: object;
	/** True only for a folder. A file at the same path answers false. */
	folderExists(path: string): boolean;
	/** True for anything at the path, folder or file. */
	pathExists(path: string): boolean;
	/** The note at `path`, or null when nothing there is a note — a folder included. */
	getFile(path: string): NoteFile | null;
	createFolder(path: string): Promise<void>;
	createFile(path: string, content: string): Promise<NoteFile>;
	readFile(file: NoteFile): Promise<string>;
	getTemplateFile(templatePath: string): NoteFile | null;
	/** The fold state saved for this file, or null when it has none. */
	readFoldState(file: NoteFile): FoldState | null;
	applyFoldState(file: NoteFile, foldState: FoldState): Promise<void>;
}

/**
 * What it takes to know which files in the vault are periodic notes, and to
 * keep knowing it as they change.
 *
 * Separate from `VaultPort` because it answers a different question: that port
 * is about one path the caller already has in hand, this one is about the whole
 * vault and what happens to it next. `ObsidianVaultAdapter` implements both, so
 * one adapter still serves both.
 */
export interface VaultIndexPort {
	/**
	 * Every markdown note in the vault.
	 *
	 * The whole list, once: a consumer that needs to know which files are
	 * periodic builds its own index off this and then keeps it current through
	 * `onChange`, rather than asking the vault again per lookup.
	 */
	listNotes(): NoteFile[];
	/**
	 * The named frontmatter field of `file` when it holds a string, else null.
	 *
	 * Narrowed to a string here rather than handing the whole frontmatter over:
	 * a frontmatter value is whatever the user typed, and the only shape any
	 * caller reads is a date written as text.
	 */
	frontmatterString(file: NoteFile, key: string): string | null;
	/**
	 * Watch the vault for file changes. Returns the unsubscribe.
	 *
	 * Every change the host reports arrives here, whoever made it: Obsidian
	 * watches the vault folder itself, so a file an external script renames is
	 * reported the same way as one renamed in the app.
	 */
	onChange(handler: (change: VaultChange) => void): () => void;
}
