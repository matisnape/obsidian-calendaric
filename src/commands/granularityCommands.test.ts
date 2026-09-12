import { describe, it, expect } from "vitest";
import type { Command } from "obsidian";
import type { CommandHost, CommandAction } from "./granularityCommands";
import { COMMAND_ACTIONS, GranularityCommands, commandId, commandName } from "./granularityCommands";
import type { Granularity, ReleaseGranularity } from "../types";

/**
 * Stands in for the Obsidian plugin the commands are registered on.
 *
 * It prefixes every id the way Obsidian does, because that is the whole point
 * of AC-CMD-05.4: removal has to name the id the HOST assigned, not the one the
 * generator asked for.
 */
class FakeCommandHost implements CommandHost {
	/** Every addCommand call, in order. */
	registered: Command[] = [];
	/** Every removeCommand call, in order. */
	removed: string[] = [];
	/** What the palette holds right now, keyed by id the way Obsidian keys it. */
	private palette = new Map<string, Command>();

	addCommand(command: Command): Command {
		const assigned = { ...command, id: `calendaric:${command.id}` };
		this.registered.push(assigned);
		this.palette.set(assigned.id, assigned);
		return assigned;
	}

	removeCommand(id: string): void {
		this.removed.push(id);
		this.palette.delete(id);
	}

	/** The ids the command palette shows right now. */
	live(): string[] {
		return [...this.palette.keys()];
	}

	/** The live command carrying this host id, or undefined. */
	find(id: string): Command | undefined {
		return this.palette.get(id);
	}
}

/** A settings-shaped object with exactly these granularities switched on. */
function enabled(...granularities: Granularity[]): Partial<Record<Granularity, { enabled: boolean }>> {
	const configs: Partial<Record<Granularity, { enabled: boolean }>> = {};
	for (const granularity of ["day", "week", "month", "quarter", "year"] as const) {
		configs[granularity] = { enabled: granularities.includes(granularity) };
	}
	return configs;
}

const hostIdsFor = (granularity: ReleaseGranularity): string[] =>
	COMMAND_ACTIONS.map((action) => `calendaric:${commandId(granularity, action)}`);

function commandsOver(host: FakeCommandHost, run: (g: ReleaseGranularity, a: CommandAction) => void = () => undefined) {
	return new GranularityCommands(host, run);
}

describe("AC-CMD-05.1: every active granularity gets the same five commands", () => {
	it("AC-CMD-05.1: registers exactly the five navigation commands for an active granularity", () => {
		const host = new FakeCommandHost();

		commandsOver(host).sync(enabled("day"));

		expect(host.live()).toEqual(hostIdsFor("day"));
		expect(COMMAND_ACTIONS).toEqual([
			"open-current",
			"jump-forward",
			"jump-backward",
			"open-next",
			"open-previous",
		]);
	});

	it("AC-CMD-05.1: gives every active granularity the same five, with no extra code per granularity", () => {
		const host = new FakeCommandHost();

		commandsOver(host).sync(enabled("day", "week", "month", "year"));

		expect(host.live()).toEqual([
			...hostIdsFor("day"),
			...hostIdsFor("week"),
			...hostIdsFor("month"),
			...hostIdsFor("year"),
		]);
	});

	it("AC-CMD-05.1: each command invokes its own action for its own granularity", () => {
		const host = new FakeCommandHost();
		const calls: string[] = [];
		commandsOver(host, (granularity, action) => calls.push(`${granularity}/${action}`)).sync(enabled("month"));

		for (const id of hostIdsFor("month")) host.find(id)?.callback?.();

		expect(calls).toEqual(COMMAND_ACTIONS.map((action) => `month/${action}`));
	});
});

describe("AC-CMD-05.2: enabling a granularity adds its commands without a restart", () => {
	it("AC-CMD-05.2: the newly enabled granularity's five commands appear on the same running instance", () => {
		const host = new FakeCommandHost();
		const commands = commandsOver(host);
		commands.sync(enabled("day"));

		commands.sync(enabled("day", "month"));

		expect(host.live()).toEqual([...hostIdsFor("day"), ...hostIdsFor("month")]);
	});

	it("AC-CMD-05.2: leaves the granularities that were already on registered exactly once", () => {
		const host = new FakeCommandHost();
		const commands = commandsOver(host);
		commands.sync(enabled("day"));

		commands.sync(enabled("day", "month"));

		expect(host.registered.filter((command) => command.id === `calendaric:${commandId("day", "open-current")}`))
			.toHaveLength(1);
		expect(host.removed).toEqual([]);
	});
});

describe("AC-CMD-05.3: disabling a granularity removes its commands without a restart", () => {
	it("AC-CMD-05.3: the disabled granularity's five commands disappear on the same running instance", () => {
		const host = new FakeCommandHost();
		const commands = commandsOver(host);
		commands.sync(enabled("day", "week"));

		commands.sync(enabled("day"));

		expect(host.live()).toEqual(hostIdsFor("day"));
		expect(host.removed).toEqual(hostIdsFor("week"));
	});
});

describe("AC-CMD-05.4: a hotkey follows the command id across a disable and a re-enable", () => {
	it("AC-CMD-05.4: removal names the id the host assigned, so the binding has nothing left to fire", () => {
		const host = new FakeCommandHost();
		const commands = commandsOver(host);
		commands.sync(enabled("week"));
		const bound = host.registered.map((command) => command.id);

		commands.sync(enabled());

		expect(host.removed).toEqual(bound);
		expect(host.live()).toEqual([]);
	});

	it("AC-CMD-05.4: re-enabling the same granularity registers the identical ids again", () => {
		const host = new FakeCommandHost();
		const commands = commandsOver(host);
		commands.sync(enabled("week"));
		const before = host.registered.map((command) => command.id);

		commands.sync(enabled());
		commands.sync(enabled("week"));

		expect(host.live()).toEqual(before);
	});
});

describe("AC-CMD-05.5 / AC-CMD-05.6: the id is frozen, whatever the behaviour or the name does", () => {
	// The ids below are the contract. A hotkey the user bound is stored against
	// one of these strings, so changing one silently unbinds it -- which is what
	// both criteria forbid. Written out rather than generated, because a list
	// generated by the code under test would agree with any change to it.
	const FROZEN_IDS = [
		"day-open-current", "day-jump-forward", "day-jump-backward", "day-open-next", "day-open-previous",
		"week-open-current", "week-jump-forward", "week-jump-backward", "week-open-next", "week-open-previous",
		"month-open-current", "month-jump-forward", "month-jump-backward", "month-open-next", "month-open-previous",
		"year-open-current", "year-jump-forward", "year-jump-backward", "year-open-next", "year-open-previous",
	];

	it("AC-CMD-05.5: every generated id is the one it has always been", () => {
		const generated = (["day", "week", "month", "year"] as const).flatMap((granularity) =>
			COMMAND_ACTIONS.map((action) => commandId(granularity, action)),
		);

		expect(generated).toEqual(FROZEN_IDS);
	});

	it("AC-CMD-05.6: the display name is no part of the id", () => {
		// Two granularities the palette names differently carry ids that differ
		// only in the granularity, never in anything the name says.
		expect(commandName("day", "open-current")).not.toBe(commandName("week", "open-current"));
		expect(commandId("day", "open-current")).toBe("day-open-current");
		expect(commandId("week", "open-current")).toBe("week-open-current");

		for (const granularity of ["day", "week", "month", "year"] as const) {
			for (const action of COMMAND_ACTIONS) {
				expect(commandId(granularity, action)).not.toContain(commandName(granularity, action));
			}
		}
	});
});

describe("AC-CMD-05.7: no granularity active means no generated commands", () => {
	it("AC-CMD-05.7: registers nothing at all when every granularity is off", () => {
		const host = new FakeCommandHost();

		commandsOver(host).sync(enabled());

		expect(host.registered).toEqual([]);
		expect(host.live()).toEqual([]);
	});
});

describe("AC-CMD-05.8: a granularity outside this release never gets a command", () => {
	it("AC-CMD-05.8: quarter is reserved, so enabling it registers nothing", () => {
		const host = new FakeCommandHost();

		commandsOver(host).sync(enabled("quarter"));

		expect(host.live()).toEqual([]);
	});

	it("AC-CMD-05.8: an enabled quarter adds nothing beside the granularities that are in the release", () => {
		const host = new FakeCommandHost();

		commandsOver(host).sync(enabled("day", "quarter"));

		expect(host.live()).toEqual(hostIdsFor("day"));
	});
});
