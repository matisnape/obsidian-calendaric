// @vitest-environment happy-dom
//
// US-CMD-04: the generated week command is the only command that opens this
// week's note. These tests load the real plugin through onload() and count
// commands by what they do when run, not by what they are called, so a
// duplicate under any name is caught.
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Command } from "obsidian";
import CalendaricPlugin from "../main";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import type { PeriodNotePorts } from "../notes/periodNoteOpen";
import { computeNotePath } from "../notes/noteUtils";
import { defaultStoredConfig, resolveEffectiveConfig } from "../settings/model";
import { restoreLocale } from "../fmt/locale";

// onload() reads the app language and draws the ribbon tooltip, and Reveal
// active note looks up the active MarkdownView; the shared mock carries none.
vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<typeof import("obsidian")>()),
	getLanguage: () => "en",
	setTooltip: () => undefined,
	MarkdownView: class {},
}));

afterEach(() => {
	restoreLocale();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function loadedPlugin(weekEnabled: boolean) {
	const stored = defaultStoredConfig();
	const set = stored.calendarSets[0];
	if (!set) throw new Error("default configuration has no calendar set");
	set.week = { ...set.week, enabled: weekEnabled };

	const vault = new FakeVaultPort();
	const ports: PeriodNotePorts = { vault, vaultConfig: new FakeVaultConfigPort(""), workspace: new FakeWorkspacePort() };

	const commands: Command[] = [];
	const on = () => ({});
	const plugin = new CalendaricPlugin({} as never, {} as never);
	Object.assign(plugin, {
		app: {
			workspace: { onLayoutReady: () => undefined, getLeavesOfType: () => [], getRightLeaf: () => null, getActiveViewOfType: () => null, on },
			vault: { on, getMarkdownFiles: () => [] },
			metadataCache: { on, offref: () => undefined, getFileCache: () => null, getFirstLinkpathDest: () => null },
		},
		loadData: () => Promise.resolve(JSON.parse(JSON.stringify(stored)) as unknown),
		saveData: () => Promise.resolve(),
		registerView: () => undefined,
		addSettingTab: () => undefined,
		registerHoverLinkSource: () => undefined,
		addRibbonIcon: () => document.createElement("div"),
		addCommand: (command: Command) => {
			commands.push(command);
			return command;
		},
		removeCommand: () => undefined,
		registerEvent: () => undefined,
		registerInterval: (id: number) => id,
		notePorts: () => ports,
	});
	await plugin.onload();

	const weekPath = computeNotePath(window.moment(), resolveEffectiveConfig(plugin.settings, "week"), ports.vaultConfig, "week");
	return { plugin, commands, ports, vault, weekPath };
}

async function commandsOpeningThisWeek(loaded: Awaited<ReturnType<typeof loadedPlugin>>): Promise<Command[]> {
	const { commands, ports, weekPath } = loaded;
	const workspace = ports.workspace as FakeWorkspacePort;
	const found: Command[] = [];
	for (const command of commands) {
		const before = workspace.opened.length;
		if (command.checkCallback) command.checkCallback(false);
		else command.callback?.();
		await flush();
		if (workspace.opened.slice(before).some(({ file }) => file.path === weekPath)) found.push(command);
	}
	return found;
}

const LEGACY_NAME = /^\s*open weekly note\s*$/i;

describe("US-CMD-04: one command opens the current week's note", () => {
	it("AC-CMD-04.1: with week enabled, exactly one command opens this week's note, creating it in the active pane", async () => {
		const loaded = await loadedPlugin(true);
		expect(loaded.plugin.settings.week.enabled).toBe(true);
		expect(loaded.vault.getFile(loaded.weekPath)).toBeNull();

		const openers = await commandsOpeningThisWeek(loaded);

		expect(openers.map((command) => command.id)).toEqual(["week-open-current"]);
		expect(loaded.vault.getFile(loaded.weekPath)).not.toBeNull();
		const workspace = loaded.ports.workspace as FakeWorkspacePort;
		expect(workspace.opened.find(({ file }) => file.path === loaded.weekPath)?.mode).toBe("reuse");
	});

	it("AC-CMD-04.1: with this week's note already there, the one command opens it and writes no second note", async () => {
		const loaded = await loadedPlugin(true);
		loaded.vault.seedFile(loaded.weekPath, "kept");

		const openers = await commandsOpeningThisWeek(loaded);

		expect(openers.map((command) => command.id)).toEqual(["week-open-current"]);
		// The day command writes today's note too; only the week's path is counted.
		expect(loaded.vault.listNotes().filter(({ path }) => path === loaded.weekPath)).toHaveLength(1);
		const note = loaded.vault.getFile(loaded.weekPath);
		expect(note && (await loaded.vault.readFile(note))).toBe("kept");
	});

	it("AC-CMD-04.2: with week enabled, no legacy Open Weekly Note command and no second command doing its job", async () => {
		const loaded = await loadedPlugin(true);

		expect(loaded.commands.filter((command) => LEGACY_NAME.test(command.name))).toEqual([]);
		expect(loaded.commands.map((command) => command.id)).not.toContain("open-weekly-note");
		expect(await commandsOpeningThisWeek(loaded)).toHaveLength(1);
	});

	it("AC-CMD-04.3: with week disabled, no command opens this week's note and Open Weekly Note is absent", async () => {
		const loaded = await loadedPlugin(false);
		expect(loaded.plugin.settings.week.enabled).toBe(false);

		expect(await commandsOpeningThisWeek(loaded)).toEqual([]);
		expect(loaded.commands.filter((command) => LEGACY_NAME.test(command.name))).toEqual([]);
		expect(loaded.commands.some((command) => command.id.startsWith("week-"))).toBe(false);
	});
});
