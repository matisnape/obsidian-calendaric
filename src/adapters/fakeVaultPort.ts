import type { NoteFile, VaultPort } from "./vaultPort";

/** In-memory VaultPort substitute for tests — no running Obsidian required. */
export class FakeVaultPort implements VaultPort {
	private folders = new Set<string>();
	private files = new Map<string, string>();
	private lostFolderRaces = new Set<string>();
	private folderErrors = new Map<string, Error>();
	createdFolders: string[] = [];
	createFileError: Error | null = null;

	/**
	 * Arrange for another actor to win the race for this folder: the next
	 * `createFolder(path)` finds it already there and fails, the way Obsidian
	 * does when the folder exists.
	 */
	loseCreateFolderRace(path: string): void {
		this.lostFolderRaces.add(path);
	}

	/** Arrange for `createFolder(path)` to fail with the folder still absent. */
	failCreateFolder(path: string, error: Error): void {
		this.folderErrors.set(path, error);
	}

	/** Seeds the folder and every ancestor, because a vault cannot hold one without the others. */
	seedFolder(path: string): void {
		const segments = path.split("/");
		for (let depth = 1; depth <= segments.length; depth++) {
			this.folders.add(segments.slice(0, depth).join("/"));
		}
	}

	seedFile(path: string, content: string): void {
		this.files.set(path, content);
	}

	contentAt(path: string): string | undefined {
		return this.files.get(path);
	}

	folderExists(path: string): boolean {
		return this.folders.has(path);
	}

	pathExists(path: string): boolean {
		return this.folders.has(path) || this.files.has(path);
	}

	getFile(path: string): NoteFile | null {
		return this.files.has(path) ? { path } : null;
	}

	async createFolder(path: string): Promise<void> {
		if (this.lostFolderRaces.delete(path)) {
			this.folders.add(path);
			throw new Error(`Folder already exists: ${path}`);
		}

		const failure = this.folderErrors.get(path);
		if (failure) throw failure;

		if (this.files.has(path)) throw new Error(`File already exists at: ${path}`);

		this.createdFolders.push(path);
		this.folders.add(path);
	}

	async createFile(path: string, content: string): Promise<NoteFile> {
		if (this.createFileError) throw this.createFileError;
		if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
		this.files.set(path, content);
		return { path };
	}

	async readFile(file: NoteFile): Promise<string> {
		const content = this.files.get(file.path);
		if (content === undefined) throw new Error(`File not found: ${file.path}`);
		return content;
	}

	getTemplateFile(templatePath: string): NoteFile | null {
		return this.files.has(templatePath) ? { path: templatePath } : null;
	}
}
