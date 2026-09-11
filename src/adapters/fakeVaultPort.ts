import type { NoteFile, VaultPort } from "./vaultPort";

/** In-memory VaultPort substitute for tests — no running Obsidian required. */
export class FakeVaultPort implements VaultPort {
	private folders = new Set<string>();
	private files = new Map<string, string>();
	createdFolders: string[] = [];
	createFileError: Error | null = null;

	seedFolder(path: string): void {
		this.folders.add(path);
	}

	seedFile(path: string, content: string): void {
		this.files.set(path, content);
	}

	contentAt(path: string): string | undefined {
		return this.files.get(path);
	}

	pathExists(path: string): boolean {
		return this.folders.has(path) || this.files.has(path);
	}

	async createFolder(path: string): Promise<void> {
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
