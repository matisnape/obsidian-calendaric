import type { App, Events } from "obsidian";
import type {
	CompanionPluginAction,
	CompanionPluginRead,
	PeriodicNotesCalendarSet,
	PeriodicNotesGranularityConfig,
	PeriodicNotesPort,
} from "./companionPluginPort";
import { findCommunityPlugin } from "./communityPluginRegistry";

/**
 * Both predecessor plugins probe the side-loaded dev build before the
 * community-store one, so a vault running the fork resolves to the plugin it is
 * actually using (docs/mapping/sources/dni.json, capability
 * `detect-periodic-notes-plugin`). First match wins, in this order.
 */
const PERIODIC_NOTES_IDS = ["periodic-notes-anks", "periodic-notes"] as const;

/** How long a hand-over waits for the plugin to say it saved. */
const SAVE_CONFIRM_MS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function mismatch<T>(problem: string): CompanionPluginRead<T> {
	return { ok: false, reason: "mismatch", problem };
}

function asText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The only place the plugin reaches into Obsidian's undocumented community
 * plugin registry to find Periodic Notes. Every hop is narrowed here, so callers
 * receive the granularity names that plugin reports, or an explicit problem.
 */
export class ObsidianPeriodicNotesAdapter implements PeriodicNotesPort {
	constructor(private app: App) {}

	readActiveGranularities(): CompanionPluginRead<readonly string[]> {
		// A foreign plugin may throw from its own method: the real manager throws
		// "No active calendar set found" when the stored active set id names a set
		// that is gone. That has to surface as an unreadable state (AC-MIG-05.4),
		// never as an exception the caller did not ask to handle (AC-MIG-05.3).
		try {
			return this.narrowActiveGranularities();
		} catch (error) {
			return mismatch(`Reading the Periodic Notes plugin failed: ${describe(error)}`);
		}
	}

	readActiveCalendarSet(): CompanionPluginRead<PeriodicNotesCalendarSet> {
		// Same reason as above: the real manager throws "No active calendar set
		// found" when the stored active id names a set that is gone, and that has
		// to arrive as an unreadable state rather than as an exception.
		try {
			return this.narrowActiveCalendarSet();
		} catch (error) {
			return mismatch(`Reading the Periodic Notes plugin failed: ${describe(error)}`);
		}
	}

	async disableGranularity(name: string): Promise<CompanionPluginAction> {
		try {
			const found = this.findPeriodicNotes();
			if (!found.ok) return { ok: false, problem: found.problem };
			const plugin = found.value;

			// The plugin's settings are a store, and writing through the store's
			// own `update` is what its settings tab does: the plugin subscribes to
			// the store and saves its data.json on every value it takes.
			const store = plugin["settings"];
			const loadData = plugin["loadData"];
			if (!isRecord(store) || typeof store["update"] !== "function" || typeof loadData !== "function") {
				return { ok: false, problem: "The Periodic Notes plugin exposes no settings store to write to." };
			}

			// The store takes the value at once, and the save runs afterwards
			// without anyone awaiting it: a failed save leaves the plugin reading
			// "off" until the next restart brings the old data.json back. So the
			// write only counts once the plugin says it saved and the file agrees.
			const saved = this.nextSettingsSave();
			// Called on the store, which may keep its value on its receiver.
			(store["update"] as (this: unknown, change: (current: unknown) => unknown) => void).call(store, (current) =>
				withGranularityOff(current, name),
			);
			if (!(await saved)) {
				return { ok: false, problem: "The Periodic Notes plugin did not confirm it saved the change." };
			}

			const onDisk: unknown = await (loadData as (this: unknown) => Promise<unknown>).call(plugin);
			if (activeEntry(onDisk, name)?.["enabled"] !== false) {
				return { ok: false, problem: `The Periodic Notes plugin's saved settings still have ${name} notes on.` };
			}
			return { ok: true };
		} catch (error) {
			return { ok: false, problem: `Writing to the Periodic Notes plugin failed: ${describe(error)}` };
		}
	}

	/**
	 * Resolves true once the plugin announces a finished save, false when it
	 * stays silent. It fires that event only after `saveData` resolves, so a
	 * save that fails is the silence (the plugin's own main.ts,
	 * `onUpdateSettings`: `await this.saveData(...)`, then the trigger).
	 */
	private nextSettingsSave(): Promise<boolean> {
		// Read as plain `Events`: the event is the plugin's own, not one Workspace declares.
		const workspace: Events = this.app.workspace;
		return new Promise((resolve) => {
			const settle = (saved: boolean): void => {
				clearTimeout(timer);
				workspace.offref(ref);
				resolve(saved);
			};
			const ref = workspace.on("periodic-notes:settings-updated", () => settle(true));
			// ponytail: fixed wait; a save is one small JSON file, a slow disk gets a failure notice and a retry.
			const timer = setTimeout(() => settle(false), SAVE_CONFIRM_MS);
		});
	}

	private findPeriodicNotes(): CompanionPluginRead<Record<string, unknown>> {
		return findCommunityPlugin(this.app, PERIODIC_NOTES_IDS, "Periodic Notes");
	}

	private narrowActiveGranularities(): CompanionPluginRead<readonly string[]> {
		const found = this.findPeriodicNotes();
		if (!found.ok) return found;

		const plugin = found.value;

		// AC-MIG-05.4: a build that publishes no calendar set manager cannot be
		// asked what it governs. The `settings` field sitting right beside it is
		// the wrong answer, not a second-best one: it is a store, and reading a
		// granularity off it reports "off" for every granularity the user enabled.
		const manager = plugin["calendarSetManager"];
		if (!isRecord(manager)) {
			return mismatch("The Periodic Notes plugin exposes no calendar set manager.");
		}

		const readActive = manager["getActiveGranularities"];
		if (typeof readActive !== "function") {
			return mismatch("The Periodic Notes plugin's calendar set manager exposes no 'getActiveGranularities' method.");
		}

		// Called on the manager: it reads the plugin's settings store off its own
		// receiver, so a detached call answers for nothing.
		const active: unknown = (readActive as (this: unknown) => unknown).call(manager);
		if (!Array.isArray(active)) {
			return mismatch("The Periodic Notes plugin's active granularities are not a list.");
		}

		const names: string[] = [];
		for (const entry of active as readonly unknown[]) {
			// A name this version does not know is another plugin's business and is
			// carried through; something that is not a name at all is a wrong
			// assumption about the plugin and is refused.
			if (typeof entry !== "string") {
				return mismatch("The Periodic Notes plugin listed an active granularity that is not a name.");
			}
			names.push(entry);
		}

		return { ok: true, value: names };
	}

	/**
	 * The active calendar set, asked of the plugin's own manager.
	 *
	 * `getActiveSet()` is the only path taken, and that is the whole of
	 * AC-MIG-04.2 and AC-MIG-04.3: the manager decides which set is active, so
	 * no other set is reachable from here, and the stale top-level
	 * daily/weekly/monthly keys sitting beside `calendarSets` in that plugin's
	 * stored data are never on the path at all. Those keys are dead in the
	 * surveyed build -- read once at migration time and never again
	 * (docs/mapping/sources/pn.json, OBS-pn-05) -- and in this vault they
	 * disagree with the set that is actually in effect.
	 */
	private narrowActiveCalendarSet(): CompanionPluginRead<PeriodicNotesCalendarSet> {
		const found = this.findPeriodicNotes();
		if (!found.ok) return found;

		const plugin = found.value;

		const manager = plugin["calendarSetManager"];
		if (!isRecord(manager)) {
			return mismatch("The Periodic Notes plugin exposes no calendar set manager.");
		}

		const readSet = manager["getActiveSet"];
		if (typeof readSet !== "function") {
			return mismatch("The Periodic Notes plugin's calendar set manager exposes no 'getActiveSet' method.");
		}

		// Called on the manager, which reads the active id off its own receiver.
		const set: unknown = (readSet as (this: unknown) => unknown).call(manager);
		if (!isRecord(set)) {
			return mismatch("The Periodic Notes plugin's active calendar set is not an object.");
		}

		// A set carries its granularity entries alongside its own `id` and
		// `ctime`. An entry is whatever is shaped like one; the two bookkeeping
		// fields are a string and a number, so neither can pass for one, and a
		// granularity name this version does not know is carried through rather
		// than refused -- the import layer picks the names it knows.
		const granularities: Record<string, PeriodicNotesGranularityConfig> = {};
		for (const [name, entry] of Object.entries(set)) {
			if (!isRecord(entry)) continue;
			granularities[name] = {
				enabled: entry["enabled"] === true,
				format: asText(entry["format"]),
				folder: asText(entry["folder"]),
				templatePath: asText(entry["templatePath"]),
				allowPrefixMatch: entry["allowPrefixMatch"] === true,
			};
		}

		return { ok: true, value: { id: asText(set["id"]), granularities } };
	}
}

/**
 * The plugin's settings with one granularity off in the active calendar set.
 *
 * The active set is found the way that plugin finds it, by
 * `activeCalendarSet` naming a set's `id`. Anything not shaped like that passes
 * through unchanged rather than guessed at: the caller's re-read then still
 * reports the granularity on, and Calendaric keeps its hands off (AC-MIG-06.6).
 */
/** The granularity's entry in the active calendar set of stored settings, if it has one. */
function activeEntry(settings: unknown, name: string): Record<string, unknown> | undefined {
	if (!isRecord(settings) || !Array.isArray(settings["calendarSets"])) return undefined;
	const active = (settings["calendarSets"] as unknown[]).find(
		(set) => isRecord(set) && set["id"] === settings["activeCalendarSet"],
	);
	const entry = isRecord(active) ? active[name] : undefined;
	return isRecord(entry) ? entry : undefined;
}

function withGranularityOff(settings: unknown, name: string): unknown {
	if (!isRecord(settings)) return settings;
	const sets = settings["calendarSets"];
	if (!Array.isArray(sets)) return settings;

	const active = settings["activeCalendarSet"];
	return {
		...settings,
		calendarSets: (sets as unknown[]).map((set) => {
			if (!isRecord(set) || set["id"] !== active) return set;
			const entry = set[name];
			if (!isRecord(entry)) return set;
			return { ...set, [name]: { ...entry, enabled: false } };
		}),
	};
}
