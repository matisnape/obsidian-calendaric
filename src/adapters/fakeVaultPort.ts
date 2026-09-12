import type { FoldState, NoteFile, VaultChange, VaultIndexPort, VaultPort } from "./vaultPort";

/** In-memory VaultPort substitute for tests — no running Obsidian required. */
export class FakeVaultPort implements VaultPort, VaultIndexPort {
	private folders = new Set<string>();
	private files = new Map<string, string>();
	private lostFolderRaces = new Set<string>();
	private folderErrors = new Map<string, Error>();
	private readErrors = new Map<string, Error>();
	private foldStates = new Map<string, FoldState>();
	private foldReadErrors = new Map<string, Error>();
	private foldApplyErrors = new Map<string, Error>();
	private frontmatter = new Map<string, Record<string, string>>();
	private handlers = new Set<(change: VaultChange) => void>();
	createdFolders: string[] = [];
	/** How many times the whole note list was asked for — a rescan is visible here. */
	listNotesCalls = 0;
	createFileError: Error | null = null;
	appliedFoldStates: { path: string; foldState: FoldState }[] = [];

	/**
	 * Arrange for another actor to win the race for this folder: the next
	 * `createFolder(path)` finds it already there and fails, the way Obsidian
	 * does when the folder exists.
	 */
	loseCreateFolderRace(path: string): void {
		this.lostFolderRaces.add(path);
	}

	/** Arrange for `readFile` to fail on a file that is otherwise there to be found. */
	failReadFile(path: string, error: Error): void {
		this.readErrors.set(path, error);
	}

	/** Arrange for `readFoldState` to fail on a template that reads fine otherwise. */
	failReadFoldState(path: string, error: Error): void {
		this.foldReadErrors.set(path, error);
	}

	/** Arrange for `applyFoldState` to fail on a note that was already created. */
	failApplyFoldState(path: string, error: Error): void {
		this.foldApplyErrors.set(path, error);
	}

	/** Arrange for `createFolder(path)` to fail with the folder still absent. */
	failCreateFolder(path: string, error: Error): void {
		this.folderErrors.set(path, error);
	}

	/** A fake is its own vault; a wrapper around one answers this same object. */
	get backingVault(): object {
		return this;
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

	seedFrontmatter(path: string, frontmatter: Record<string, string>): void {
		this.frontmatter.set(path, frontmatter);
	}

	/** Moves a seeded file, the way the host does before it reports the rename. */
	renameFile(from: string, to: string): void {
		const content = this.files.get(from);
		if (content === undefined) throw new Error(`File not found: ${from}`);
		this.files.delete(from);
		this.files.set(to, content);

		const frontmatter = this.frontmatter.get(from);
		if (frontmatter) {
			this.frontmatter.delete(from);
			this.frontmatter.set(to, frontmatter);
		}
	}

	deleteFile(path: string): void {
		this.files.delete(path);
		this.frontmatter.delete(path);
	}

	/** Reports a change to everything subscribed through `onChange`. */
	emitChange(change: VaultChange): void {
		for (const handler of [...this.handlers]) handler(change);
	}

	seedFoldState(path: string, foldState: FoldState): void {
		this.foldStates.set(path, foldState);
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

	listNotes(): NoteFile[] {
		this.listNotesCalls++;
		return [...this.files.keys()].filter((path) => path.endsWith(".md")).map((path) => ({ path }));
	}

	frontmatterString(file: NoteFile, key: string): string | null {
		return this.frontmatter.get(file.path)?.[key] ?? null;
	}

	onChange(handler: (change: VaultChange) => void): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
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
		const failure = this.readErrors.get(file.path);
		if (failure) throw failure;

		const content = this.files.get(file.path);
		if (content === undefined) throw new Error(`File not found: ${file.path}`);
		return content;
	}

	getTemplateFile(templatePath: string): NoteFile | null {
		return this.files.has(templatePath) ? { path: templatePath } : null;
	}

	readFoldState(file: NoteFile): FoldState | null {
		const failure = this.foldReadErrors.get(file.path);
		if (failure) throw failure;
		return this.foldStates.get(file.path) ?? null;
	}

	async applyFoldState(file: NoteFile, foldState: FoldState): Promise<void> {
		const failure = this.foldApplyErrors.get(file.path);
		if (failure) throw failure;
		this.appliedFoldStates.push({ path: file.path, foldState });
	}
}
