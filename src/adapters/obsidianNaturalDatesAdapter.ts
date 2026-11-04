import type { App } from "obsidian";
import type { NaturalDatesPort } from "./companionPluginPort";
import { findCommunityPlugin } from "./communityPluginRegistry";

const NLDATES_IDS = ["nldates-obsidian"] as const;

type ParseDate = (this: unknown, phrase: string) => unknown;

export class ObsidianNaturalDatesAdapter implements NaturalDatesPort {
	constructor(private app: App) {}

	isAvailable(): boolean {
		return this.parser() !== null;
	}

	parseDate(phrase: string): Date | null {
		const found = this.parser();
		if (!found) return null;
		try {
			// Its answer is { formattedString, date, moment }; `date` is an
			// Invalid Date when the phrase names none.
			const result: unknown = found.parse.call(found.plugin, phrase);
			const date = typeof result === "object" && result !== null ? (result as Record<string, unknown>)["date"] : undefined;
			return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
		} catch {
			return null;
		}
	}

	private parser(): { plugin: Record<string, unknown>; parse: ParseDate } | null {
		const found = findCommunityPlugin(this.app, NLDATES_IDS, "Natural Language Dates");
		if (!found.ok) return null;
		const parse = found.value["parseDate"];
		return typeof parse === "function" ? { plugin: found.value, parse: parse as ParseDate } : null;
	}
}
