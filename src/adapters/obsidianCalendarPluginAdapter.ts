import type { App } from "obsidian";
import type { CalendarPluginPort, CompanionPluginAction, CompanionPluginRead } from "./companionPluginPort";
import { findCommunityPlugin } from "./communityPluginRegistry";

/**
 * The dev build first, then the community-store build -- the order every
 * cross-plugin lookup in the predecessor forks uses (docs/mapping/sources/
 * forks.json, capability `dev-plugin-id-fallback`). First match wins.
 */
const CALENDAR_IDS = ["calendar-anks", "calendar"] as const;

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The only place the plugin reaches into the Calendar plugin. Its `options`
 * field is a plain record the plugin keeps in step with its settings store, and
 * `writeOptions` is the one call that changes a setting and saves it
 * (docs/mapping/sources/cal.json, api_surface).
 */
export class ObsidianCalendarPluginAdapter implements CalendarPluginPort {
	constructor(private app: App) {}

	readCalendarWeeklyNotes(): CompanionPluginRead<boolean> {
		try {
			const found = findCommunityPlugin(this.app, CALENDAR_IDS, "Calendar");
			if (!found.ok) return found;

			const options = found.value["options"];
			const showWeeklyNote = typeof options === "object" && options !== null
				? (options as Record<string, unknown>)["showWeeklyNote"]
				: undefined;
			if (typeof showWeeklyNote !== "boolean") {
				return { ok: false, reason: "mismatch", problem: "The Calendar plugin reported no usable 'showWeeklyNote' setting." };
			}
			return { ok: true, value: showWeeklyNote };
		} catch (error) {
			return { ok: false, reason: "mismatch", problem: `Reading the Calendar plugin failed: ${describe(error)}` };
		}
	}

	async disableCalendarWeeklyNotes(): Promise<CompanionPluginAction> {
		try {
			const found = findCommunityPlugin(this.app, CALENDAR_IDS, "Calendar");
			if (!found.ok) return { ok: false, problem: found.problem };

			const plugin = found.value;
			const writeOptions = plugin["writeOptions"];
			const loadData = plugin["loadData"];
			if (typeof writeOptions !== "function" || typeof loadData !== "function") {
				return { ok: false, problem: "The Calendar plugin exposes no 'writeOptions' method." };
			}

			// Called on the plugin: it patches its store, then saves `this.options`.
			// The patch lands before the save, so a save that fails still leaves
			// the plugin reading "off" until a restart -- only its data.json says
			// whether the change will last.
			await (writeOptions as (this: unknown, change: () => Record<string, unknown>) => Promise<void>).call(
				plugin,
				() => ({ showWeeklyNote: false }),
			);
			const onDisk: unknown = await (loadData as (this: unknown) => Promise<unknown>).call(plugin);
			if (typeof onDisk !== "object" || onDisk === null || (onDisk as Record<string, unknown>)["showWeeklyNote"] !== false) {
				return { ok: false, problem: "The Calendar plugin's saved settings still have weekly notes on." };
			}
			return { ok: true };
		} catch (error) {
			return { ok: false, problem: `Writing to the Calendar plugin failed: ${describe(error)}` };
		}
	}
}
