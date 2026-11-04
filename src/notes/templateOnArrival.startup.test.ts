// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import type { Command } from "obsidian";
import { TFile } from "obsidian";
import CalendaricPlugin from "../main";
import { DEFAULT_PERIODIC_CONFIG } from "../types";

/**
 * AC-NOTE-10.3 through the plugin itself: where the subscription is made is
 * the whole criterion. Obsidian reports every file already in the vault as a
 * `create` while it loads, before the layout is ready (obsidian.d.ts,
 * `Vault.on("create")`), so only a subscription made at layout-ready tells a
 * file that was there from one that has just arrived (DEC-13).
 */

window.moment.locale("en");

vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<typeof import("obsidian")>()),
	getLanguage: () => "en",
	setTooltip: () => undefined,
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fileAt(path: string): TFile {
	const file = new TFile();
	file.path = path;
	return file;
}

async function loadPlugin() {
	const contents = new Map<string, string>([["Templates/daily.md", "# {{title}}\n"]]);
	const files: TFile[] = [];
	const handlers = new Map<string, ((file: TFile) => void)[]>();
	let layoutReady: (() => void) | null = null;

	const on = (name: string, handler: (file: TFile) => void) => {
		handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		return { name, handler };
	};
	const offref = (ref: { name: string; handler: (file: TFile) => void }) => {
		handlers.set(ref.name, (handlers.get(ref.name) ?? []).filter((handler) => handler !== ref.handler));
	};
	const template = fileAt("Templates/daily.md");
	const dayConfig = { ...DEFAULT_PERIODIC_CONFIG, enabled: true, format: "YYYY-MM-DD", folder: "Daily", templatePath: template.path };

	const instance = new CalendaricPlugin({} as never, {} as never);
	Object.assign(instance, {
		app: {
			workspace: {
				onLayoutReady: (callback: () => void) => {
					layoutReady = callback;
				},
				getLeavesOfType: () => [],
				getRightLeaf: () => null,
				detachLeavesOfType: () => undefined,
				on: () => ({}),
			},
			vault: {
				on,
				offref,
				getMarkdownFiles: () => [...files],
				read: (file: TFile) => Promise.resolve(contents.get(file.path) ?? ""),
				process: (file: TFile, transform: (data: string) => string) => {
					const next = transform(contents.get(file.path) ?? "");
					contents.set(file.path, next);
					return Promise.resolve(next);
				},
			},
			metadataCache: {
				on: () => ({}),
				offref: () => undefined,
				getFileCache: () => null,
				getFirstLinkpathDest: (path: string) => (path === template.path ? template : null),
			},
		},
		loadData: () => Promise.resolve({ activeCalendarSet: "Default", calendarSets: [{ id: "Default", day: dayConfig }] }),
		registerView: () => undefined,
		addSettingTab: () => undefined,
		registerHoverLinkSource: () => undefined,
		addRibbonIcon: () => document.createElement("div"),
		addCommand: (command: Command) => command,
		registerEvent: () => undefined,
		registerInterval: (id: number) => id,
	});
	await instance.onload();

	/** A file appearing in the vault: on disk first, then reported as a create. */
	const create = (path: string) => {
		const file = fileAt(path);
		files.push(file);
		contents.set(path, "");
		for (const handler of handlers.get("create") ?? []) handler(file);
	};

	return {
		create,
		contentAt: (path: string) => contents.get(path),
		createListeners: () => handlers.get("create")?.length ?? 0,
		fireLayoutReady: async () => {
			(layoutReady as unknown as () => void)();
			await settle();
		},
		unload: () => {
			instance.onunload();
		},
	};
}

describe("AC-NOTE-10.3: the startup line is drawn at layout-ready", () => {
	it("AC-NOTE-10.3: an empty matching file reported while the vault loads is left untouched; one created after is templated", async () => {
		const plugin = await loadPlugin();

		plugin.create("Daily/2026-04-12.md");
		await settle();
		await plugin.fireLayoutReady();
		plugin.create("Daily/2026-04-13.md");
		await settle();

		expect(plugin.contentAt("Daily/2026-04-12.md")).toBe("");
		expect(plugin.contentAt("Daily/2026-04-13.md")).toBe("# 2026-04-13\n");
	});

	it("AC-NOTE-10.1: the plugin's subscription is removed on unload", async () => {
		const plugin = await loadPlugin();
		await plugin.fireLayoutReady();

		plugin.unload();

		// The index's listener and the arrival template's both go; a leaked one
		// would keep running after the plugin is gone.
		expect(plugin.createListeners()).toBe(0);
	});
});
