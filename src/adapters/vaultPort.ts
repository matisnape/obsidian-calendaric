export interface NoteFile {
	path: string;
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
}
