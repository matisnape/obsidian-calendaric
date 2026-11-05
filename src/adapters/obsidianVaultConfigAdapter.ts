import type { App } from "obsidian";
import type { VaultConfigPort } from "./vaultConfigPort";

/** Wires VaultConfigPort to Obsidian's undocumented vault.config. */
export class ObsidianVaultConfigAdapter implements VaultConfigPort {
	constructor(private app: App) {}

	getDefaultNewFileFolder(): string {
		const config = (this.app.vault as unknown as { config?: Record<string, unknown> }).config;
		if (!config) return "";

		const location = config["newFileLocation"];
		if (location === "folder") {
			const path = config["newFileFolderPath"];
			return typeof path === "string" ? path : "";
		}
		return "";
	}
}
