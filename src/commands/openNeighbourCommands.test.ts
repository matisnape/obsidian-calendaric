import { describe, it, expect } from "vitest";
import type { Command } from "obsidian";
import CalendaricPlugin from "../main";
import { openNeighbourNote } from "./openNeighbourCommands";
import { GranularityCommands } from "./granularityCommands";
import type { CommandAction, CommandHost } from "./granularityCommands";
import { PeriodicNoteIndex } from "../notes/periodicNoteIndex";
import type { PeriodicConfigs } from "../notes/periodicNoteIndex";
import { DEFAULT_PERIODIC_CONFIG } from "../types";
import type { PeriodicConfig, ReleaseGranularity } from "../types";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";

function config(format: string, folder: string): PeriodicConfig {
	return { ...DEFAULT_PERIODIC_CONFIG, enabled: true, format, folder };
}

const CONFIGS = {
	day: config("YYYY-MM-DD", "Daily"),
	week: config("GGGG-[W]WW", "Weekly"),
	month: config("YYYY-MM", "Monthly"),
} satisfies PeriodicConfigs;

function setUp(...paths: string[]) {
	const vault = new FakeVaultPort();
	for (const path of paths) vault.seedFile(path, "");
	const vaultConfig = new FakeVaultConfigPort("");
	const workspace = new FakeWorkspacePort();
	const index = new PeriodicNoteIndex(vault, vaultConfig, CONFIGS);
	const ports = { vault, vaultConfig, workspace };
	const notePaths = () => vault.listNotes().map((file) => file.path).sort();
	const opened = () => workspace.opened.map(({ file, mode }) => [file.path, mode]);
	return { vault, workspace, index, ports, notePaths, opened };
}

type Granularity = keyof typeof CONFIGS;

async function run(
	world: ReturnType<typeof setUp>,
	granularity: Granularity,
	direction: "forward" | "backward",
	activePath: string | null,
): Promise<void> {
	await openNeighbourNote(granularity, direction, activePath, world.index, CONFIGS[granularity], world.ports);
}

describe("AC-CMD-07.1: Open next opens the existing next note", () => {
	it("AC-CMD-07.1: opens the note of the period after the active note's, in the active pane", async () => {
		const world = setUp("Daily/2020-01-06.md", "Daily/2020-01-07.md", "Daily/2020-01-09.md");

		await run(world, "day", "forward", "Daily/2020-01-06.md");

		expect(world.opened()).toEqual([["Daily/2020-01-07.md", "reuse"]]);
		expect(world.notePaths()).toEqual(["Daily/2020-01-06.md", "Daily/2020-01-07.md", "Daily/2020-01-09.md"]);
	});

	it("AC-CMD-07.1: finds the next note by what the index knows, not by the path the format would write", async () => {
		const world = setUp("Daily/2020-01-06.md", "Daily/tuesday.md");
		world.vault.seedFrontmatter("Daily/tuesday.md", { day: "2020-01-07" });
		world.index.applySettings(CONFIGS);

		await run(world, "day", "forward", "Daily/2020-01-06.md");

		expect(world.opened()).toEqual([["Daily/tuesday.md", "reuse"]]);
		expect(world.notePaths()).toEqual(["Daily/2020-01-06.md", "Daily/tuesday.md"]);
	});
});

describe("AC-CMD-07.2: Open next creates the next note when it is missing", () => {
	it("AC-CMD-07.2: creates the next day's note and opens it in the active pane", async () => {
		const world = setUp("Daily/2020-01-06.md");

		await run(world, "day", "forward", "Daily/2020-01-06.md");

		expect(world.notePaths()).toEqual(["Daily/2020-01-06.md", "Daily/2020-01-07.md"]);
		expect(world.opened()).toEqual([["Daily/2020-01-07.md", "reuse"]]);
	});

	it("AC-CMD-07.2: counts weeks and months from the active note, across a year boundary", async () => {
		const world = setUp("Weekly/2026-W53.md", "Monthly/2026-12.md");

		await run(world, "week", "forward", "Weekly/2026-W53.md");
		await run(world, "month", "forward", "Monthly/2026-12.md");

		expect(world.opened()).toEqual([
			["Weekly/2027-W01.md", "reuse"],
			["Monthly/2027-01.md", "reuse"],
		]);
	});
});

describe("AC-CMD-07.3: Open previous creates the previous note when it is missing", () => {
	it("AC-CMD-07.3: creates the previous day's note and opens it in the active pane", async () => {
		const world = setUp("Daily/2020-03-01.md");

		await run(world, "day", "backward", "Daily/2020-03-01.md");

		expect(world.notePaths()).toEqual(["Daily/2020-02-29.md", "Daily/2020-03-01.md"]);
		expect(world.opened()).toEqual([["Daily/2020-02-29.md", "reuse"]]);
	});

	it("AC-CMD-07.3: steps back one week and one month across a year boundary", async () => {
		const world = setUp("Weekly/2026-W01.md", "Monthly/2026-01.md");

		await run(world, "week", "backward", "Weekly/2026-W01.md");
		await run(world, "month", "backward", "Monthly/2026-01.md");

		expect(world.opened()).toEqual([
			["Weekly/2025-W52.md", "reuse"],
			["Monthly/2025-12.md", "reuse"],
		]);
	});
});

class FakeCommandHost implements CommandHost {
	palette = new Map<string, Command>();

	addCommand(command: Command): Command {
		const filed = { ...command, id: `calendaric:${command.id}` };
		this.palette.set(filed.id, filed);
		return filed;
	}

	removeCommand(id: string): void {
		this.palette.delete(id);
	}

	shown(id: string): boolean {
		const command = this.palette.get(`calendaric:${id}`);
		if (!command) return false;
		return command.checkCallback ? command.checkCallback(true) === true : true;
	}
}

describe("AC-CMD-07.4: Open next and Open previous are offered only from a periodic note of their granularity", () => {
	function commandsWith(active: ReleaseGranularity | null, calls: string[] = []) {
		const host = new FakeCommandHost();
		const run = (granularity: ReleaseGranularity, action: CommandAction) => calls.push(`${granularity}/${action}`);
		new GranularityCommands(host, run, () => active).sync({ day: { enabled: true }, week: { enabled: true } });
		return host;
	}

	it("AC-CMD-07.4: hides both when the active pane holds no periodic note", () => {
		const host = commandsWith(null);

		expect(host.shown("day-open-next")).toBe(false);
		expect(host.shown("day-open-previous")).toBe(false);
	});

	it("AC-CMD-07.4: hides a granularity's pair when the active note is of another granularity", () => {
		const host = commandsWith("week");

		expect(host.shown("day-open-next")).toBe(false);
		expect(host.shown("day-open-previous")).toBe(false);
		expect(host.shown("week-open-next")).toBe(true);
		expect(host.shown("week-open-previous")).toBe(true);
	});

	it("AC-CMD-07.4: leaves Open current in the palette wherever the user is", () => {
		expect(commandsWith(null).shown("day-open-current")).toBe(true);
	});

	it("AC-CMD-07.4: a shown command runs its own action; a hidden one runs nothing", () => {
		const calls: string[] = [];
		const host = commandsWith("week", calls);

		host.palette.get("calendaric:day-open-next")?.checkCallback?.(false);
		host.palette.get("calendaric:week-open-previous")?.checkCallback?.(false);

		expect(calls).toEqual(["week/open-previous"]);
	});

	it("AC-CMD-07.4: run by hotkey from a pane without that granularity's note, it opens and creates nothing", async () => {
		const world = setUp("Daily/2020-01-06.md", "Weekly/2020-W02.md", "Notes/idea.md");
		const before = world.notePaths();

		await run(world, "day", "forward", "Notes/idea.md");
		await run(world, "day", "backward", "Weekly/2020-W02.md");
		await run(world, "day", "forward", null);

		expect(world.opened()).toEqual([]);
		expect(world.notePaths()).toEqual(before);
	});
});

describe("AC-CMD-07.2, AC-CMD-07.4: the plugin wires Open next and Open previous to the active pane", () => {
	async function pluginWith(activePath: string | null, world = setUp("Daily/2020-01-06.md")) {
		const host = new FakeCommandHost();
		const view = activePath === null ? null : { file: { path: activePath } };
		const instance = new CalendaricPlugin({} as never, {} as never);
		Object.assign(instance, {
			app: { workspace: { getActiveViewOfType: () => view } },
			loadData: () => Promise.resolve(null),
			addCommand: (command: Command) => host.addCommand(command),
			removeCommand: (id: string) => host.removeCommand(id),
			index: world.index,
			notePorts: () => world.ports,
		});
		await instance.loadSettings();
		instance.settings.day = { ...instance.settings.day, ...CONFIGS.day };
		const plugin = instance as unknown as {
			registerGranularityCommands(): void;
			runGranularityCommand(granularity: ReleaseGranularity, action: CommandAction): Promise<void>;
		};
		plugin.registerGranularityCommands();
		return { host, plugin, world };
	}

	it("AC-CMD-07.4: lists the daily Open next only while a daily note is the active pane", async () => {
		expect((await pluginWith(null)).host.shown("day-open-next")).toBe(false);
		expect((await pluginWith("Notes/idea.md")).host.shown("day-open-next")).toBe(false);
		expect((await pluginWith("Daily/2020-01-06.md")).host.shown("day-open-next")).toBe(true);
	});

	it("AC-CMD-07.2: the plugin's Open next and Open previous count from the active note, not from today", async () => {
		const { plugin, world } = await pluginWith("Daily/2020-01-06.md");

		await plugin.runGranularityCommand("day", "open-next");
		await plugin.runGranularityCommand("day", "open-previous");

		expect(world.opened()).toEqual([
			["Daily/2020-01-07.md", "reuse"],
			["Daily/2020-01-05.md", "reuse"],
		]);
	});
});
