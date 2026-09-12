import { TFile, TFolder } from "obsidian";
import type { App, EventRef } from "obsidian";
import type { FoldState, NoteFile, VaultChange, VaultIndexPort, VaultPort } from "./vaultPort";

/**
 * Obsidian's fold store is not part of the published API, so it is described
 * here by the two calls this plugin makes and reached through a cast. Older
 * versions may not carry it at all, which is why every use is guarded.
 */
interface FoldManager {
	load(file: TFile): FoldState | null;
	save(file: TFile, foldState: FoldState): Promise<void>;
}

/** Wires VaultPort to the real Obsidian Vault/MetadataCache API. */
export class ObsidianVaultAdapter implements VaultPort, VaultIndexPort {
	constructor(private app: App) {}

	get backingVault(): object {
		return this.app.vault;
	}

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

	listNotes(): NoteFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	frontmatterString(file: NoteFile, key: string): string | null {
		if (!(file instanceof TFile)) return null;
		// Obsidian types a frontmatter value as `any`; it is whatever the user
		// typed, so it is read as `unknown` and narrowed here instead.
		const frontmatter: Record<string, unknown> | undefined = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const value = frontmatter?.[key];
		return typeof value === "string" ? value : null;
	}

	onChange(handler: (change: VaultChange) => void): () => void {
		const vaultRefs: EventRef[] = [
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile) handler({ kind: "create", file });
			}),
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile) handler({ kind: "delete", file });
			}),
			// Fires for a rename made anywhere, the app or an external script:
			// Obsidian watches the vault folder and reports what it finds.
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) handler({ kind: "rename", file, oldPath });
			}),
		];
		// The frontmatter of a new file is parsed after the create event, so a
		// caller reading frontmatter needs this second source to see it at all.
		const metadataRef = this.app.metadataCache.on("changed", (file) => {
			handler({ kind: "metadata", file });
		});

		return () => {
			for (const ref of vaultRefs) this.app.vault.offref(ref);
			this.app.metadataCache.offref(metadataRef);
		};
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

	readFoldState(file: NoteFile): FoldState | null {
		const foldManager = this.foldManager();
		if (!foldManager || !(file instanceof TFile)) return null;
		return foldManager.load(file);
	}

	async applyFoldState(file: NoteFile, foldState: FoldState): Promise<void> {
		const foldManager = this.foldManager();
		if (!foldManager || !(file instanceof TFile)) return;
		await foldManager.save(file, foldState);
	}

	private foldManager(): FoldManager | undefined {
		return (this.app as App & { foldManager?: FoldManager }).foldManager;
	}
}
