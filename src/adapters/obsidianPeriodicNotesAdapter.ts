import type { App } from "obsidian";
import type {
	CompanionPluginRead,
	PeriodicNotesCalendarSet,
	PeriodicNotesGranularityConfig,
	PeriodicNotesPort,
} from "./companionPluginPort";

/**
 * Both predecessor plugins probe the side-loaded dev build before the
 * community-store one, so a vault running the fork resolves to the plugin it is
 * actually using (docs/mapping/sources/dni.json, capability
 * `detect-periodic-notes-plugin`). First match wins, in this order.
 */
const PERIODIC_NOTES_IDS = ["periodic-notes-anks", "periodic-notes"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function absent<T>(problem: string): CompanionPluginRead<T> {
	return { ok: false, reason: "absent", problem };
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

	/**
	 * Resolves the Periodic Notes plugin object. Each hop is read exactly once
	 * and the read value is what gets used, so a getter-backed property cannot
	 * validate on one read and differ on the next.
	 */
	private findPeriodicNotes(): CompanionPluginRead<Record<string, unknown>> {
		// App's public type carries no community plugin registry, so the hop goes
		// through unknown rather than any: nothing below is trusted until narrowed.
		const registry: unknown = (this.app as unknown as Record<string, unknown>)["plugins"];

		// Only a missing registry is ordinary absence. One that exists in another
		// shape means this code is wrong about the host it runs in.
		if (registry === undefined || registry === null) {
			return absent("Obsidian exposed no community plugin registry to read Periodic Notes from.");
		}
		if (!isRecord(registry)) {
			return mismatch("Obsidian's community plugin registry is not an object.");
		}

		const lookup = registry["getPlugin"];
		if (typeof lookup !== "function") {
			return mismatch("Obsidian's community plugin registry exposes no 'getPlugin' method.");
		}

		for (const id of PERIODIC_NOTES_IDS) {
			// Called on the registry, because the host's own method reads state
			// from its receiver.
			const plugin: unknown = (lookup as (this: unknown, id: string) => unknown).call(registry, id);
			if (plugin === undefined || plugin === null) continue;
			if (!isRecord(plugin)) {
				return mismatch(`The Periodic Notes plugin registered as '${id}' is not an object.`);
			}
			return { ok: true, value: plugin };
		}

		return absent("The Periodic Notes plugin is not installed.");
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
