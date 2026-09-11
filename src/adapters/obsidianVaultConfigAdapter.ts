import type { App } from "obsidian";
import type { VaultConfigPort } from "./vaultConfigPort";

/** Wires VaultConfigPort to Obsidian's undocumented vault.config. */
export class ObsidianVaultConfigAdapter implements VaultConfigPort {
	constructor(private app: App) {}

	getDefaultNewFileFolder(): string {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const config = (this.app.vault as any).config as Record<string, unknown> | undefined;
		if (!config) return "";

		const location = config["newFileLocation"];
		if (location === "folder") {
			const path = config["newFileFolderPath"];
			return typeof path === "string" ? path : "";
		}
		return "";
	}
}
