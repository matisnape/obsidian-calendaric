import { describe, it, expect } from "vitest";
import type { Command } from "obsidian";
import { jumpToClosestNote } from "./jumpCommands";
import { GranularityCommands, commandName } from "./granularityCommands";
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

const CONFIGS: PeriodicConfigs = {
	day: config("YYYY-MM-DD", "Daily"),
	week: config("GGGG-[W]WW", "Weekly"),
};

function vaultWith(...paths: string[]): FakeVaultPort {
	const vault = new FakeVaultPort();
	for (const path of paths) vault.seedFile(path, "");
	return vault;
}

const indexOver = (vault: FakeVaultPort) => new PeriodicNoteIndex(vault, new FakeVaultConfigPort(""), CONFIGS);
const notePaths = (vault: FakeVaultPort) => vault.listNotes().map((file) => file.path);

describe("AC-CMD-06.1: Jump forward opens the closest later note, creating none", () => {
	it("AC-CMD-06.1: opens the closest later note of the active note's granularity in the active pane", async () => {
		const vault = vaultWith("Daily/2026-04-10.md", "Daily/2026-04-13.md", "Daily/2026-04-15.md", "Daily/2026-04-20.md");
		const workspace = new FakeWorkspacePort();

		await jumpToClosestNote("day", "forward", "Daily/2026-04-13.md", indexOver(vault), workspace);

		expect(workspace.opened.map(({ file, mode }) => [file.path, mode])).toEqual([["Daily/2026-04-15.md", "reuse"]]);
	});

	it("AC-CMD-06.1: counts from the note in the active pane, not from today", async () => {
		const vault = vaultWith("Daily/2020-01-06.md", "Daily/2020-01-09.md", "Daily/2020-02-01.md");
		const workspace = new FakeWorkspacePort();

		await jumpToClosestNote("day", "forward", "Daily/2020-01-06.md", indexOver(vault), workspace);

		expect(workspace.opened.map(({ file }) => file.path)).toEqual(["Daily/2020-01-09.md"]);
	});

	it("AC-CMD-06.1: creates no note on the way", async () => {
		const vault = vaultWith("Daily/2026-04-13.md", "Daily/2026-04-20.md");
		const before = notePaths(vault);

		await jumpToClosestNote("day", "forward", "Daily/2026-04-13.md", indexOver(vault), new FakeWorkspacePort());

		expect(notePaths(vault)).toEqual(before);
		expect(vault.createdFolders).toEqual([]);
	});

	it("AC-CMD-06.1: Jump backward opens the closest earlier note the same way", async () => {
		const vault = vaultWith("Daily/2026-04-01.md", "Daily/2026-04-10.md", "Daily/2026-04-13.md");
		const workspace = new FakeWorkspacePort();

		await jumpToClosestNote("day", "backward", "Daily/2026-04-13.md", indexOver(vault), workspace);

		expect(workspace.opened.map(({ file, mode }) => [file.path, mode])).toEqual([["Daily/2026-04-10.md", "reuse"]]);
	});

	it("AC-CMD-06.1: the palette calls the command \"Jump forward\"", () => {
		expect(commandName("day", "jump-forward")).toMatch(/^Jump forward\b/);
		expect(commandName("day", "jump-backward")).toMatch(/^Jump backward\b/);
	});
});

describe("AC-CMD-06.2: Jump forward with no later note says so and creates nothing", () => {
	it("AC-CMD-06.2: tells the user there is no next note, opening and creating nothing", async () => {
		// A later WEEKLY note is not an answer to a daily jump.
		const vault = vaultWith("Daily/2026-04-10.md", "Daily/2026-04-13.md", "Weekly/2026-W20.md");
		const before = notePaths(vault);
		const workspace = new FakeWorkspacePort();

		await jumpToClosestNote("day", "forward", "Daily/2026-04-13.md", indexOver(vault), workspace);

		expect(workspace.notices).toEqual(["No next daily note."]);
		expect(workspace.opened).toEqual([]);
		expect(notePaths(vault)).toEqual(before);
	});
});

describe("AC-CMD-06.3: Jump backward with no earlier note says so and creates nothing", () => {
	it("AC-CMD-06.3: tells the user there is no previous note, opening and creating nothing", async () => {
		const vault = vaultWith("Weekly/2026-W01.md", "Weekly/2026-W16.md", "Daily/2026-04-20.md");
		const before = notePaths(vault);
		const workspace = new FakeWorkspacePort();

		await jumpToClosestNote("week", "backward", "Weekly/2026-W01.md", indexOver(vault), workspace);

		expect(workspace.notices).toEqual(["No previous weekly note."]);
		expect(workspace.opened).toEqual([]);
		expect(notePaths(vault)).toEqual(before);
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

const ALL_ON = { day: { enabled: true }, week: { enabled: true } };

describe("AC-CMD-06.4: the jumps are offered only from a periodic note of their granularity", () => {
	function commandsWith(active: ReleaseGranularity | null, calls: string[] = []) {
		const host = new FakeCommandHost();
		const run = (granularity: ReleaseGranularity, action: CommandAction) => calls.push(`${granularity}/${action}`);
		new GranularityCommands(host, run, () => active).sync(ALL_ON);
		return host;
	}

	it("AC-CMD-06.4: hides both jumps when the active pane holds no periodic note", () => {
		const host = commandsWith(null);

		expect(host.shown("day-jump-forward")).toBe(false);
		expect(host.shown("day-jump-backward")).toBe(false);
	});

	it("AC-CMD-06.4: hides a granularity's jumps when the active note is of another granularity", () => {
		const host = commandsWith("week");

		expect(host.shown("day-jump-forward")).toBe(false);
		expect(host.shown("day-jump-backward")).toBe(false);
		expect(host.shown("week-jump-forward")).toBe(true);
		expect(host.shown("week-jump-backward")).toBe(true);
	});

	it("AC-CMD-06.4: leaves the open commands in the palette wherever the user is", () => {
		const host = commandsWith(null);

		for (const action of ["open-current", "open-next", "open-previous"]) {
			expect(host.shown(`day-${action}`)).toBe(true);
		}
	});

	it("AC-CMD-06.4: a shown jump runs its own action; a hidden one runs nothing", () => {
		const calls: string[] = [];
		const host = commandsWith("week", calls);

		host.palette.get("calendaric:day-jump-forward")?.checkCallback?.(false);
		host.palette.get("calendaric:week-jump-forward")?.checkCallback?.(false);

		expect(calls).toEqual(["week/jump-forward"]);
	});

	it("AC-CMD-06.4: a jump run from a pane without that granularity's note opens nothing", async () => {
		const vault = vaultWith("Daily/2026-04-13.md", "Daily/2026-04-20.md", "Notes/idea.md");
		const workspace = new FakeWorkspacePort();
		const index = indexOver(vault);

		await jumpToClosestNote("day", "forward", "Notes/idea.md", index, workspace);
		await jumpToClosestNote("day", "forward", null, index, workspace);

		expect(workspace.opened).toEqual([]);
		expect(workspace.notices).toEqual([]);
	});

	it("AC-CMD-06.4: the index names the granularity of the note at a path, and none for other files", () => {
		const vault = vaultWith("Daily/2026-04-13.md", "Weekly/2026-W16.md", "Notes/idea.md");
		const index = indexOver(vault);

		expect(index.granularityOf("Daily/2026-04-13.md")).toBe("day");
		expect(index.granularityOf("Weekly/2026-W16.md")).toBe("week");
		expect(index.granularityOf("Notes/idea.md")).toBeNull();
	});
});
