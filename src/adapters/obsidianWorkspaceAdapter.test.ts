import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { ObsidianWorkspaceAdapter } from "./obsidianWorkspaceAdapter";

interface VaultSpy {
	app: App;
	requestedLeaves: unknown[];
	openedFiles: TFile[];
	fileAt(path: string): TFile;
	/** A different file takes over the path, as a delete-then-create would do. */
	replaceAt(path: string): TFile;
	/** Obsidian rewrites path on the same instance, so a move mutates the handle. */
	move(from: string, to: string): void;
	/** A folder can occupy a note's path; it resolves but is not openable. */
	putFolderAt(path: string): TFile;
}

// Structural App fixture — the leaf argument per destination and the identity of
// the file that gets opened are the whole contract, so both are pinned here
// without a running Obsidian.
function makeVault(existingPaths: string[]): VaultSpy {
	const requestedLeaves: unknown[] = [];
	const openedFiles: TFile[] = [];
	const files = new Map<string, unknown>();

	function put(path: string): TFile {
		const file = new TFile();
		file.path = path;
		files.set(path, file);
		return file;
	}
	for (const path of existingPaths) put(path);

	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => files.get(path) ?? null,
		},
		workspace: {
			getLeaf: (newLeaf?: unknown) => {
				requestedLeaves.push(newLeaf);
				return {
					openFile: (file: TFile) => {
						openedFiles.push(file);
						return Promise.resolve();
					},
				};
			},
		},
	} as unknown as App;

	return {
		app,
		requestedLeaves,
		openedFiles,
		fileAt: (path) => {
			const file = files.get(path);
			if (!file) throw new Error(`fixture has no file at ${path}`);
			return file as TFile;
		},
		replaceAt: (path) => put(path),
		move: (from, to) => {
			const file = files.get(from) as TFile | undefined;
			if (!file) throw new Error(`fixture has no file at ${from}`);
			files.delete(from);
			file.path = to;
			files.set(to, file);
		},
		putFolderAt: (path) => {
			const folder = { path, children: [] };
			files.set(path, folder);
			return folder as unknown as TFile;
		},
	};
}

const PATH = "journal/daily/2026-04-13.md";

describe("ObsidianWorkspaceAdapter", () => {
	it("AC-NOTE-06.1: asks for the active leaf so the current unpinned tab is reused", async () => {
		const vault = makeVault([PATH]);
		const file = vault.fileAt(PATH);

		const result = await new ObsidianWorkspaceAdapter(vault.app).openInLeaf(file, PATH, "reuse");

		expect(result).toBe("opened");
		expect(vault.requestedLeaves).toEqual([false]);
		expect(vault.openedFiles).toEqual([file]);
	});

	it("AC-NOTE-06.2: asks for a split leaf", async () => {
		const vault = makeVault([PATH]);

		await new ObsidianWorkspaceAdapter(vault.app).openInLeaf(vault.fileAt(PATH), PATH, "split");

		expect(vault.requestedLeaves).toEqual(["split"]);
	});

	it("AC-NOTE-06.3: asks for a tab leaf", async () => {
		const vault = makeVault([PATH]);

		await new ObsidianWorkspaceAdapter(vault.app).openInLeaf(vault.fileAt(PATH), PATH, "tab");

		expect(vault.requestedLeaves).toEqual(["tab"]);
	});

	it("AC-NOTE-06.4: reports the file as missing when the path no longer resolves", async () => {
		const vault = makeVault([PATH]);
		const file = vault.fileAt(PATH);
		vault.move(PATH, "archive/2026-04-13.md");

		const result = await new ObsidianWorkspaceAdapter(vault.app).openInLeaf(file, PATH, "reuse");

		expect(result).toBe("missing");
	});

	it("AC-NOTE-06.4: claims no leaf and opens nothing when the path no longer resolves", async () => {
		const vault = makeVault([]);
		const orphan = new TFile();
		orphan.path = PATH;

		await new ObsidianWorkspaceAdapter(vault.app).openInLeaf(orphan, PATH, "split");

		expect(vault.requestedLeaves).toEqual([]);
		expect(vault.openedFiles).toEqual([]);
	});

	it("AC-NOTE-06.4: opens nothing when an unrelated file has taken over the path", async () => {
		const vault = makeVault([PATH]);
		const original = vault.fileAt(PATH);
		const impostor = vault.replaceAt(PATH);

		const result = await new ObsidianWorkspaceAdapter(vault.app).openInLeaf(original, PATH, "reuse");

		expect(result).toBe("missing");
		expect(vault.openedFiles).toEqual([]);
		expect(vault.openedFiles).not.toContain(impostor);
	});

	it("AC-NOTE-06.4: opens nothing when the note moved away and another file took its old path", async () => {
		const vault = makeVault([PATH]);
		const original = vault.fileAt(PATH);
		vault.move(PATH, "archive/2026-04-13.md");
		const impostor = vault.replaceAt(PATH);

		// The handle's own path now reads "archive/…"; resolving that would open the
		// note at its new home and hide the move. The path it was found at is what counts.
		const result = await new ObsidianWorkspaceAdapter(vault.app).openInLeaf(original, PATH, "reuse");

		expect(result).toBe("missing");
		expect(vault.openedFiles).toEqual([]);
		expect(vault.openedFiles).not.toContain(impostor);
	});

	it("AC-NOTE-06.4: opens nothing when a folder now occupies the path", async () => {
		const vault = makeVault([]);
		// The same object the vault holds, so only the TFile check can reject it.
		const folder = vault.putFolderAt(PATH);

		const result = await new ObsidianWorkspaceAdapter(vault.app).openInLeaf(folder, PATH, "reuse");

		expect(result).toBe("missing");
		expect(vault.openedFiles).toEqual([]);
	});
});
