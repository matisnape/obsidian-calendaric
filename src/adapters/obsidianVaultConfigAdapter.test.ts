import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { ObsidianVaultConfigAdapter } from "./obsidianVaultConfigAdapter";

// Structural App fixture — vault.config is Obsidian's undocumented internal
// shape, so this pins the adapter's mapping of it without a running Obsidian.
function makeApp(config?: Record<string, unknown>): App {
	return { vault: { config } } as unknown as App;
}

describe("ObsidianVaultConfigAdapter", () => {
	it("returns the configured folder when newFileLocation is 'folder'", () => {
		const adapter = new ObsidianVaultConfigAdapter(
			makeApp({ newFileLocation: "folder", newFileFolderPath: "Inbox" }),
		);
		expect(adapter.getDefaultNewFileFolder()).toBe("Inbox");
	});

	it("returns an empty string when newFileLocation is 'root'", () => {
		const adapter = new ObsidianVaultConfigAdapter(makeApp({ newFileLocation: "root" }));
		expect(adapter.getDefaultNewFileFolder()).toBe("");
	});

	it("returns an empty string when newFileLocation is 'current'", () => {
		const adapter = new ObsidianVaultConfigAdapter(makeApp({ newFileLocation: "current" }));
		expect(adapter.getDefaultNewFileFolder()).toBe("");
	});

	it("returns an empty string when vault.config is missing", () => {
		const adapter = new ObsidianVaultConfigAdapter(makeApp(undefined));
		expect(adapter.getDefaultNewFileFolder()).toBe("");
	});

	it("returns an empty string when newFileFolderPath is not a string", () => {
		const adapter = new ObsidianVaultConfigAdapter(
			makeApp({ newFileLocation: "folder", newFileFolderPath: 42 }),
		);
		expect(adapter.getDefaultNewFileFolder()).toBe("");
	});
});
