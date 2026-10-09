// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import type { Command } from "obsidian";
import CalendaricPlugin from "../main";
import { REVEAL_ACTIVE_NOTE_COMMAND_ID, REVEAL_NEEDS_NOTE, revealActiveNote, revealActiveNoteCommand } from "./revealActiveNoteCommand";
import type { RevealActiveNoteDeps } from "./revealActiveNoteCommand";
import { resolveFileDate } from "../fmt/resolveFileDate";
import type { FileConfigs } from "../fmt/resolveFileDate";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { DEFAULT_PERIODIC_CONFIG } from "../types";
import type { PeriodicConfig } from "../types";

// onload() reads the app language and draws the ribbon tooltip; the shared
// mock carries neither.
vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<typeof import("obsidian")>()),
	getLanguage: () => "en",
	setTooltip: () => undefined,
}));

function config(format: string, folder: string): PeriodicConfig {
	return { ...DEFAULT_PERIODIC_CONFIG, enabled: true, format, folder };
}

const CONFIGS: FileConfigs = {
	day: config("YYYY-MM-DD", "Daily"),
	week: config("GGGG-[W]WW", "Weekly"),
	month: config("YYYY-MM", "Monthly"),
};

/**
 * A host whose calendar view only exists once open() has finished, the way a
 * deferred leaf on a restored session only loads its view when revealed.
 */
function host(activePath: string | null) {
	const calls: string[] = [];
	let loaded = false;
	const view = { revealActiveNote: () => calls.push("reveal") };
	const deps: RevealActiveNoteDeps = {
		activePath: () => activePath,
		resolve: (path) => resolveFileDate(path, CONFIGS, new FakeVaultConfigPort("")),
		open: async () => {
			calls.push("open");
			await new Promise((resolve) => setTimeout(resolve, 0));
			loaded = true;
		},
		view: () => (loaded ? view : null),
		notify: (message) => calls.push(`notice: ${message}`),
	};
	return { deps, calls };
}

describe("US-CMD-03: Reveal active note", () => {
	it.each(["Daily/2026-03-14.md", "Weekly/2026-W11.md"])(
		"AC-CMD-03.1: opens the calendar, then reveals the active note %s in it",
		async (path) => {
			const { deps, calls } = host(path);

			await revealActiveNote(deps);

			expect(calls).toEqual(["open", "reveal"]);
		},
	);

	it.each([null, "Projects/plan.md", "Monthly/2026-03.md"])(
		"AC-CMD-03.2: with %s in the active pane, shows the notice and leaves the calendar alone",
		async (path) => {
			const { deps, calls } = host(path);

			await expect(revealActiveNote(deps)).resolves.toBeUndefined();

			expect(calls).toEqual([`notice: ${REVEAL_NEEDS_NOTE}`]);
			expect(REVEAL_NEEDS_NOTE).toBe('"Reveal active note" needs an open daily or weekly note.');
		},
	);

	it("AC-CMD-03.3: the loaded plugin registers it with a plain callback, so the palette always lists it enabled", async () => {
		const commands = await registeredCommands();
		const command = commands.find((candidate) => candidate.id === REVEAL_ACTIVE_NOTE_COMMAND_ID);

		expect(command?.name).toBe("Reveal active note");
		expect(command?.callback).toBeTypeOf("function");
		expect(command?.checkCallback).toBeUndefined();
		expect(revealActiveNoteCommand(host(null).deps).checkCallback).toBeUndefined();
	});
});

async function registeredCommands(): Promise<Command[]> {
	const commands: Command[] = [];
	const on = () => ({});
	const app = {
		workspace: {
			onLayoutReady: () => undefined,
			getLeavesOfType: () => [],
			on,
		},
		vault: { on, getMarkdownFiles: () => [] },
		metadataCache: { on, offref: () => undefined, getFileCache: () => null, getFirstLinkpathDest: () => null },
	};

	const instance = new CalendaricPlugin({} as never, {} as never);
	Object.assign(instance, {
		app,
		loadData: () => Promise.resolve(null),
		registerView: () => undefined,
		addSettingTab: () => undefined,
		registerHoverLinkSource: () => undefined,
		addRibbonIcon: () => document.createElement("div"),
		addCommand: (command: Command) => {
			commands.push(command);
			return command;
		},
		registerEvent: () => undefined,
		registerInterval: (id: number) => id,
	});
	await instance.onload();
	return commands;
}
