import type { Command } from "obsidian";
import type { ReleaseGranularity } from "../types";
import { isReleaseGranularity } from "../types";
import type { EnabledSource } from "../settings/model";
import { getActiveGranularities } from "../settings/model";

/**
 * The five things a navigation command does for one granularity.
 *
 * The order is the order the palette lists them in, and each entry is also half
 * of a command id, so an entry is never renamed or reordered: a hotkey the user
 * bound is stored against the id these build (AC-CMD-05.5, AC-CMD-05.6).
 */
export const COMMAND_ACTIONS = [
	"open-current",
	"jump-forward",
	"jump-backward",
	"open-next",
	"open-previous",
] as const;

export type CommandAction = (typeof COMMAND_ACTIONS)[number];

/**
 * The id a granularity's command carries, for good.
 *
 * Built from the granularity and the action alone. Nothing the palette
 * DISPLAYS reaches this function, so renaming a command cannot move the id a
 * hotkey is bound to (AC-CMD-05.6), and changing what a command does cannot
 * either (AC-CMD-05.5).
 */
export function commandId(granularity: ReleaseGranularity, action: CommandAction): string {
	return `${granularity}-${action}`;
}

/** What each granularity's notes are called, for the palette to read naturally. */
const ADJECTIVE: Record<ReleaseGranularity, string> = {
	day: "daily",
	week: "weekly",
	month: "monthly",
	year: "yearly",
};

/** The palette wording of each action. Free to change: no id reads it. */
const PHRASE: Record<CommandAction, string> = {
	"open-current": "Open current",
	"jump-forward": "Jump to next existing",
	"jump-backward": "Jump to previous existing",
	"open-next": "Open next",
	"open-previous": "Open previous",
};

/** What the command palette shows for one command. */
export function commandName(granularity: ReleaseGranularity, action: CommandAction): string {
	return `${PHRASE[action]} ${ADJECTIVE[granularity]} note`;
}

/**
 * Whatever the commands are registered on. `Plugin` satisfies it.
 *
 * `addCommand` hands back the command as the host filed it, and the id on that
 * object is the one `removeCommand` has to be given: Obsidian prefixes the id
 * with the plugin's own, so the string the generator asked for is not the
 * string that removes it again (AC-CMD-05.4).
 */
export interface CommandHost {
	addCommand(command: Command): Command;
	removeCommand(id: string): void;
}

/** Runs one command. Supplied by the plugin, so this module stays free of the vault. */
export type RunCommand = (granularity: ReleaseGranularity, action: CommandAction) => void;

/**
 * The command palette's view of the active granularities, kept in step with the
 * configuration.
 *
 * One template drives all of them, which is the point of US-CMD-05: a
 * granularity that becomes active gets the whole set without anyone writing a
 * command for it, and a granularity that is switched off loses the whole set.
 *
 * `sync` is called on load and again after every settings change, so neither
 * addition nor removal waits for a restart (AC-CMD-05.2, AC-CMD-05.3).
 */
export class GranularityCommands {
	/** The id this generator asked for -> the id the host filed it under. */
	private registered = new Map<string, string>();

	constructor(
		private host: CommandHost,
		private run: RunCommand,
	) {}

	/** Register what the configuration now wants, and drop what it no longer wants. */
	sync(configs: EnabledSource): void {
		// Quarter is reserved (DEC-23) and never reaches this list, so an active
		// quarter gets no command however the configuration is written
		// (AC-CMD-05.8). An empty list removes everything (AC-CMD-05.7).
		const active = getActiveGranularities(configs).filter(isReleaseGranularity);
		const wanted = new Map<string, { granularity: ReleaseGranularity; action: CommandAction }>();
		for (const granularity of active) {
			for (const action of COMMAND_ACTIONS) wanted.set(commandId(granularity, action), { granularity, action });
		}

		for (const [id, hostId] of this.registered) {
			if (wanted.has(id)) continue;
			this.host.removeCommand(hostId);
			this.registered.delete(id);
		}

		for (const [id, { granularity, action }] of wanted) {
			// Already in the palette: re-adding would give the host two commands
			// for one id and cost the user's hotkey its target.
			if (this.registered.has(id)) continue;

			const filed = this.host.addCommand({
				id,
				name: commandName(granularity, action),
				callback: () => this.run(granularity, action),
			});
			this.registered.set(id, filed.id);
		}
	}
}
