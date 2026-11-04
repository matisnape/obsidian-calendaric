import type { App } from "obsidian";
import type {
	CalendarPluginPort,
	CalendarPluginSettings,
	CalendarSettingsPort,
	CompanionPluginAction,
	CompanionPluginRead,
} from "./companionPluginPort";
import { findCommunityPlugin } from "./communityPluginRegistry";

/**
 * The dev build first, then the community-store build -- the order every
 * cross-plugin lookup in the predecessor forks uses (docs/mapping/sources/
 * forks.json, capability `dev-plugin-id-fallback`). First match wins.
 */
const CALENDAR_IDS = ["calendar-anks", "calendar"] as const;

const CALENDAR_SETTING_TYPES: Record<keyof CalendarPluginSettings, "string" | "boolean" | "number"> = {
	weekStart: "string",
	shouldConfirmBeforeCreate: "boolean",
	showWeeklyNote: "boolean",
	wordsPerDot: "number",
	localeOverride: "string",
	weeklyNoteFormat: "string",
	weeklyNoteFolder: "string",
	weeklyNoteTemplate: "string",
};

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The only place the plugin reaches into the Calendar plugin. Its `options`
 * field is a plain record the plugin keeps in step with its settings store, and
 * `writeOptions` is the one call that changes a setting and saves it
 * (docs/mapping/sources/cal.json, api_surface).
 */
export class ObsidianCalendarPluginAdapter implements CalendarPluginPort, CalendarSettingsPort {
	constructor(private app: App) {}

	readCalendarWeeklyNotes(): CompanionPluginRead<boolean> {
		try {
			const options = this.readOptions();
			if (!options.ok) return options;

			const showWeeklyNote = options.value?.["showWeeklyNote"];
			if (typeof showWeeklyNote !== "boolean") {
				return { ok: false, reason: "mismatch", problem: "The Calendar plugin reported no usable 'showWeeklyNote' setting." };
			}
			return { ok: true, value: showWeeklyNote };
		} catch (error) {
			return { ok: false, reason: "mismatch", problem: `Reading the Calendar plugin failed: ${describe(error)}` };
		}
	}

	readCalendarSettings(): CompanionPluginRead<CalendarPluginSettings> {
		try {
			const options = this.readOptions();
			if (!options.ok) return options;
			if (options.value === undefined) {
				return { ok: false, reason: "mismatch", problem: "The Calendar plugin reported no settings object." };
			}

			const settings: Record<string, unknown> = {};
			for (const [key, type] of Object.entries(CALENDAR_SETTING_TYPES)) {
				const value = options.value[key];
				if (value === undefined || value === null) continue;
				if (typeof value !== type) {
					return { ok: false, reason: "mismatch", problem: `The Calendar plugin's '${key}' setting is not a ${type}.` };
				}
				settings[key] = value;
			}
			return { ok: true, value: settings as CalendarPluginSettings };
		} catch (error) {
			return { ok: false, reason: "mismatch", problem: `Reading the Calendar plugin failed: ${describe(error)}` };
		}
	}

	/** The enabled plugin's `options`, or undefined when that is not an object. Both reads start here. */
	private readOptions(): CompanionPluginRead<Record<string, unknown> | undefined> {
		const found = findCommunityPlugin(this.app, CALENDAR_IDS, "Calendar");
		if (!found.ok) return found;
		const options = found.value["options"];
		return { ok: true, value: typeof options === "object" && options !== null ? (options as Record<string, unknown>) : undefined };
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
