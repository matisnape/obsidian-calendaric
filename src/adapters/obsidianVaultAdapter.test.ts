import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { ObsidianVaultAdapter } from "./obsidianVaultAdapter";
import type { VaultChange } from "./vaultPort";

type Listener = (...args: unknown[]) => void;

interface Emitter {
	handlers: Map<string, Listener[]>;
	fire(name: string, ...args: unknown[]): void;
}

function emitter(): Emitter {
	const handlers = new Map<string, Listener[]>();
	return {
		handlers,
		fire(name, ...args) {
			for (const handler of handlers.get(name) ?? []) handler(...args);
		},
	};
}

interface HostSpy {
	app: App;
	vaultEvents: Emitter;
	metadataEvents: Emitter;
	fileAt(path: string): TFile;
	setFrontmatter(path: string, frontmatter: Record<string, unknown>): void;
}

// Structural App fixture: the two event emitters and the metadata cache are the
// whole contract of what this adapter adds, so they are pinned here without a
// running Obsidian.
function makeHost(paths: string[]): HostSpy {
	const files = new Map<string, TFile>();
	const frontmatters = new Map<string, Record<string, unknown>>();
	const vaultEvents = emitter();
	const metadataEvents = emitter();

	for (const path of paths) {
		const file = new TFile();
		file.path = path;
		files.set(path, file);
	}

	function register(events: Emitter, name: string, callback: Listener): { name: string; callback: Listener } {
		const list = events.handlers.get(name) ?? [];
		list.push(callback);
		events.handlers.set(name, list);
		return { name, callback };
	}

	function unregister(events: Emitter, ref: unknown): void {
		const { name, callback } = ref as { name: string; callback: Listener };
		const list = events.handlers.get(name) ?? [];
		events.handlers.set(name, list.filter((entry) => entry !== callback));
	}

	const app = {
		vault: {
			getMarkdownFiles: () => [...files.values()],
			on: (name: string, callback: Listener) => register(vaultEvents, name, callback),
			offref: (ref: unknown) => unregister(vaultEvents, ref),
		},
		metadataCache: {
			getFileCache: (file: TFile) => {
				const frontmatter = frontmatters.get(file.path);
				return frontmatter ? { frontmatter } : null;
			},
			on: (name: string, callback: Listener) => register(metadataEvents, name, callback),
			offref: (ref: unknown) => unregister(metadataEvents, ref),
		},
	} as unknown as App;

	return {
		app,
		vaultEvents,
		metadataEvents,
		fileAt: (path) => {
			const file = files.get(path);
			if (!file) throw new Error(`fixture has no file at ${path}`);
			return file;
		},
		setFrontmatter: (path, frontmatter) => frontmatters.set(path, frontmatter),
	};
}

function collect(host: HostSpy): { changes: VaultChange[]; stop: () => void } {
	const changes: VaultChange[] = [];
	const stop = new ObsidianVaultAdapter(host.app).onChange((change) => changes.push(change));
	return { changes, stop };
}

describe("ObsidianVaultAdapter — the whole note list", () => {
	it("AC-NOTE-11.1: answers with every markdown file the vault holds", () => {
		const host = makeHost(["Daily/2026-04-13.md", "Weekly/2026-W16.md"]);

		const paths = new ObsidianVaultAdapter(host.app).listNotes().map((file) => file.path);

		expect(paths).toEqual(["Daily/2026-04-13.md", "Weekly/2026-W16.md"]);
	});
});

describe("ObsidianVaultAdapter — a frontmatter field", () => {
	it("AC-NOTE-11.6: reads the field a file's frontmatter carries", () => {
		const host = makeHost(["Daily/Planning.md"]);
		host.setFrontmatter("Daily/Planning.md", { day: "2026-04-13" });

		const value = new ObsidianVaultAdapter(host.app).frontmatterString(host.fileAt("Daily/Planning.md"), "day");

		expect(value).toBe("2026-04-13");
	});

	it("AC-NOTE-11.6: answers null for a field that is not a string", () => {
		const host = makeHost(["Daily/Planning.md"]);
		// A frontmatter value is whatever the user typed, and Obsidian parses
		// an unquoted date into a Date rather than a string.
		host.setFrontmatter("Daily/Planning.md", { day: new Date("2026-04-13") });

		const value = new ObsidianVaultAdapter(host.app).frontmatterString(host.fileAt("Daily/Planning.md"), "day");

		expect(value).toBeNull();
	});

	it("answers null for a file with no frontmatter at all", () => {
		const host = makeHost(["Daily/Planning.md"]);

		const value = new ObsidianVaultAdapter(host.app).frontmatterString(host.fileAt("Daily/Planning.md"), "day");

		expect(value).toBeNull();
	});
});

describe("ObsidianVaultAdapter — watching the vault", () => {
	it("AC-NOTE-11.2: reports a created file", () => {
		const host = makeHost(["Daily/2026-04-13.md"]);
		const { changes } = collect(host);

		host.vaultEvents.fire("create", host.fileAt("Daily/2026-04-13.md"));

		expect(changes).toEqual([{ kind: "create", file: host.fileAt("Daily/2026-04-13.md") }]);
	});

	it("AC-NOTE-11.3: reports a rename with the path the file had before", () => {
		// The vault's own rename event is the mechanism: Obsidian watches the
		// vault folder, so a rename made by an external script arrives here the
		// same way as one made in the app.
		const host = makeHost(["Daily/2026-04-13, pretty.md"]);
		const { changes } = collect(host);

		host.vaultEvents.fire("rename", host.fileAt("Daily/2026-04-13, pretty.md"), "Daily/2026-04-13.md");

		expect(changes).toEqual([{
			kind: "rename",
			file: host.fileAt("Daily/2026-04-13, pretty.md"),
			oldPath: "Daily/2026-04-13.md",
		}]);
	});

	it("AC-NOTE-11.7: reports a deleted file", () => {
		const host = makeHost(["Daily/2026-04-13.md"]);
		const { changes } = collect(host);

		host.vaultEvents.fire("delete", host.fileAt("Daily/2026-04-13.md"));

		expect(changes).toEqual([{ kind: "delete", file: host.fileAt("Daily/2026-04-13.md") }]);
	});

	it("AC-NOTE-11.6: reports the metadata read that follows a file being written", () => {
		const host = makeHost(["Daily/Planning.md"]);
		const { changes } = collect(host);

		host.metadataEvents.fire("changed", host.fileAt("Daily/Planning.md"));

		expect(changes).toEqual([{ kind: "metadata", file: host.fileAt("Daily/Planning.md") }]);
	});

	it("ignores a folder, which the vault reports through the same events", () => {
		const host = makeHost([]);
		const { changes } = collect(host);

		host.vaultEvents.fire("create", { path: "Daily" });

		expect(changes).toEqual([]);
	});

	it("stops reporting once the unsubscribe is called, on both emitters", () => {
		const host = makeHost(["Daily/2026-04-13.md"]);
		const { changes, stop } = collect(host);

		stop();
		host.vaultEvents.fire("create", host.fileAt("Daily/2026-04-13.md"));
		host.metadataEvents.fire("changed", host.fileAt("Daily/2026-04-13.md"));

		expect(changes).toEqual([]);
	});
});
