import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { ObsidianWorkspaceAdapter } from "./obsidianWorkspaceAdapter";

const PATH = "journal/daily/2026-04-13.md";

interface LeafFixture {
	type: string;
	file: string;
	/** A restored tab not shown yet: no `view.file`, only its saved view state. */
	deferred?: boolean;
}

// Structural App fixture: which leaf gets revealed and made active, and whether
// a new leaf is ever asked for, are the whole contract.
function makeWorkspace(leafFixtures: LeafFixture[]) {
	const files = new Map<string, unknown>();
	const note = new TFile();
	note.path = PATH;
	files.set(PATH, note);

	const leaves = leafFixtures.map((fixture) => ({
		isDeferred: fixture.deferred ?? false,
		view: fixture.deferred ? {} : { file: files.get(fixture.file) ?? null },
		getViewState: () => ({ type: fixture.type, state: { file: fixture.file } }),
	}));
	const revealed: unknown[] = [];
	const activated: unknown[] = [];
	const requestedLeaves: unknown[] = [];

	const app = {
		vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null },
		workspace: {
			iterateAllLeaves: (callback: (leaf: unknown) => unknown) => leaves.forEach(callback),
			revealLeaf: (leaf: unknown) => {
				revealed.push(leaf);
				return Promise.resolve();
			},
			setActiveLeaf: (leaf: unknown) => activated.push(leaf),
			getLeaf: (newLeaf?: unknown) => {
				requestedLeaves.push(newLeaf);
				return { openFile: () => Promise.resolve() };
			},
		},
	} as unknown as App;

	return {
		adapter: new ObsidianWorkspaceAdapter(app),
		note,
		leaves,
		revealed,
		activated,
		requestedLeaves,
		replaceNote: () => {
			const impostor = new TFile();
			impostor.path = PATH;
			files.set(PATH, impostor);
		},
	};
}

describe("ObsidianWorkspaceAdapter.activateIfOpen", () => {
	it("AC-CMD-09.5: a loaded tab already showing the note is revealed and made active, and no leaf is requested", async () => {
		const w = makeWorkspace([
			{ type: "markdown", file: "journal/other.md" },
			{ type: "markdown", file: PATH },
		]);

		expect(await w.adapter.activateIfOpen(w.note, PATH)).toBe(true);

		expect(w.revealed).toEqual([w.leaves[1]]);
		expect(w.activated).toEqual([w.leaves[1]]);
		expect(w.requestedLeaves).toEqual([]);
	});

	it("AC-CMD-09.5: a restored tab that Obsidian has not loaded yet is found by its saved state", async () => {
		const w = makeWorkspace([{ type: "markdown", file: PATH, deferred: true }]);

		expect(await w.adapter.activateIfOpen(w.note, PATH)).toBe(true);

		expect(w.activated).toEqual([w.leaves[0]]);
		expect(w.requestedLeaves).toEqual([]);
	});

	it("a backlinks pane about the note is not the note, so nothing is activated", async () => {
		const w = makeWorkspace([{ type: "backlink", file: PATH }]);

		expect(await w.adapter.activateIfOpen(w.note, PATH)).toBe(false);

		expect(w.revealed).toEqual([]);
		expect(w.activated).toEqual([]);
	});

	it("a different file now at the path is not activated, even with a tab showing that path", async () => {
		const w = makeWorkspace([{ type: "markdown", file: PATH }]);
		w.replaceNote();

		expect(await w.adapter.activateIfOpen(w.note, PATH)).toBe(false);

		expect(w.activated).toEqual([]);
	});
});
