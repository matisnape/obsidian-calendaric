import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { ObsidianWorkspaceAdapter } from "./obsidianWorkspaceAdapter";

interface AppSpy {
	app: App;
	requestedLeaves: unknown[];
	openedPaths: string[];
}

// Structural App fixture — the leaf argument Obsidian expects per destination is
// the whole contract of this adapter, so it is pinned without a running Obsidian.
function makeApp(existingPaths: string[]): AppSpy {
	const requestedLeaves: unknown[] = [];
	const openedPaths: string[] = [];
	const files = new Map<string, TFile>();
	for (const path of existingPaths) {
		const file = new TFile();
		file.path = path;
		files.set(path, file);
	}

	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => files.get(path) ?? null,
		},
		workspace: {
			getLeaf: (newLeaf?: unknown) => {
				requestedLeaves.push(newLeaf);
				return {
					openFile: (file: TFile) => {
						openedPaths.push(file.path);
						return Promise.resolve();
					},
				};
			},
		},
	} as unknown as App;

	return { app, requestedLeaves, openedPaths };
}

const PATH = "journal/daily/2026-04-13.md";

describe("ObsidianWorkspaceAdapter", () => {
	it("AC-NOTE-06.1: asks for the active leaf so the current unpinned tab is reused", async () => {
		const spy = makeApp([PATH]);

		const result = await new ObsidianWorkspaceAdapter(spy.app).openInLeaf({ path: PATH }, "reuse");

		expect(result).toBe("opened");
		expect(spy.requestedLeaves).toEqual([false]);
		expect(spy.openedPaths).toEqual([PATH]);
	});

	it("AC-NOTE-06.2: asks for a split leaf", async () => {
		const spy = makeApp([PATH]);

		await new ObsidianWorkspaceAdapter(spy.app).openInLeaf({ path: PATH }, "split");

		expect(spy.requestedLeaves).toEqual(["split"]);
	});

	it("AC-NOTE-06.3: asks for a tab leaf", async () => {
		const spy = makeApp([PATH]);

		await new ObsidianWorkspaceAdapter(spy.app).openInLeaf({ path: PATH }, "tab");

		expect(spy.requestedLeaves).toEqual(["tab"]);
	});

	it("AC-NOTE-06.4: reports the file as missing when the path no longer resolves", async () => {
		const spy = makeApp([]);

		const result = await new ObsidianWorkspaceAdapter(spy.app).openInLeaf({ path: PATH }, "reuse");

		expect(result).toBe("missing");
	});

	it("AC-NOTE-06.4: claims no leaf and opens nothing when the path no longer resolves", async () => {
		const spy = makeApp([]);

		await new ObsidianWorkspaceAdapter(spy.app).openInLeaf({ path: PATH }, "split");

		expect(spy.requestedLeaves).toEqual([]);
		expect(spy.openedPaths).toEqual([]);
	});

	it("AC-NOTE-06.4: opens the file the path resolves to now, not the stale handle it was given", async () => {
		const spy = makeApp([PATH]);
		const stale = { path: PATH, unrelated: "a handle from before the move" };

		await new ObsidianWorkspaceAdapter(spy.app).openInLeaf(stale, "reuse");

		expect(spy.openedPaths).toEqual([PATH]);
	});
});
