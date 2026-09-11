import { TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import type { NoteFile, VaultPort } from "./vaultPort";

/** Wires VaultPort to the real Obsidian Vault/MetadataCache API. */
export class ObsidianVaultAdapter implements VaultPort {
	constructor(private app: App) {}

	folderExists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(path) instanceof TFolder;
	}

	pathExists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(path) !== null;
	}

	getFile(path: string): NoteFile | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		// Only a note counts. A TFolder at the same path still answers pathExists,
		// which is how callers tell "occupied" from "free".
		return file instanceof TFile ? file : null;
	}

	async createFolder(path: string): Promise<void> {
		await this.app.vault.createFolder(path);
	}

	async createFile(path: string, content: string): Promise<NoteFile> {
		return await this.app.vault.create(path, content);
	}

	async readFile(file: NoteFile): Promise<string> {
		if (!(file instanceof TFile)) {
			throw new Error(`Expected a TFile at path: ${file.path}`);
		}
		return await this.app.vault.read(file);
	}

	getTemplateFile(templatePath: string): NoteFile | null {
		return this.app.metadataCache.getFirstLinkpathDest(templatePath, "");
	}
}
