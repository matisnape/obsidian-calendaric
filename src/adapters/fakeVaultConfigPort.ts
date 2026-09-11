import type { VaultConfigPort } from "./vaultConfigPort";

/** In-memory VaultConfigPort substitute for tests — no running Obsidian required. */
export class FakeVaultConfigPort implements VaultConfigPort {
	constructor(private defaultNewFileFolder: string = "") {}

	getDefaultNewFileFolder(): string {
		return this.defaultNewFileFolder;
	}
}
