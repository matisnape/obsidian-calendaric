import type { App } from "obsidian";
import type {
	CompanionPluginAction,
	CompanionPluginPort,
	CompanionPluginRead,
	DailyNotesPluginState,
} from "./companionPluginPort";

const DAILY_NOTES_ID = "daily-notes";

/**
 * The accessor contracts a state container publishes its values through instead
 * of exposing them directly. Reading such a container as a plain record yields
 * undefined for every field, which is how a feature ships broken for every user
 * while every call still appears to succeed.
 *
 * `subscribe` comes first because it is the Svelte store contract the recorded
 * defect was about, and a store carrying both publishes the same value through
 * either one.
 */
const ACCESSOR_KEYS = ["subscribe", "get"] as const;

const SETTING_KEYS = ["format", "folder", "template"] as const;

type SettingKey = (typeof SETTING_KEYS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function absent<T>(problem: string): CompanionPluginRead<T> {
	return { ok: false, reason: "absent", problem };
}

function mismatch<T>(problem: string): CompanionPluginRead<T> {
	return { ok: false, reason: "mismatch", problem };
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * AC-ARCH-07.2: reads a state container the way the container itself requires.
 *
 * A Svelte-style store keeps its value inside the subscription and exposes
 * nothing as a property, so `options.format` is undefined for every field while
 * the read still reports success -- the P1 this port was written to stop.
 * Detecting such a container and refusing it leaves the read just as broken, so
 * the accessor is used rather than merely recognised. A container with no
 * accessor is already the record of values and is returned unchanged.
 */
function readStateContainer(container: Record<string, unknown>): CompanionPluginRead<Record<string, unknown>> {
	const accessor = ACCESSOR_KEYS.find((key) => typeof container[key] === "function");
	if (accessor === undefined) return { ok: true, value: container };

	const published = accessor === "subscribe" ? readBySubscribe(container) : readByGet(container);

	// AC-ARCH-07.3: the accessor ran and still produced nothing this code can
	// read. Reading on would store an empty format, folder and template over the
	// user's own while reporting a successful import.
	if (!isRecord(published)) {
		return mismatch(
			`The core Daily Notes plugin's options container published no readable values through its '${accessor}' accessor.`,
		);
	}

	return { ok: true, value: published };
}

/**
 * The store contract: subscribing publishes the current value at once, and
 * hands back the unsubscriber. The settings tab re-reads on every render, so a
 * subscription left open per render is a leak the user can neither see nor
 * recover from.
 */
function readBySubscribe(container: Record<string, unknown>): unknown {
	const subscribe = container["subscribe"] as (this: unknown, run: (value: unknown) => void) => unknown;
	let published: unknown;
	const release = subscribe.call(container, (value) => {
		published = value;
	});
	if (typeof release === "function") (release as (this: unknown) => void).call(container);
	return published;
}

function readByGet(container: Record<string, unknown>): unknown {
	const get = container["get"] as (this: unknown) => unknown;
	return get.call(container);
}

/**
 * The only place the plugin reaches into Obsidian's undocumented internal
 * plugin registry. Every field is narrowed here, so callers receive a value
 * that already matches DailyNotesPluginState or an explicit problem.
 */
export class ObsidianCompanionPluginAdapter implements CompanionPluginPort {
	constructor(private app: App) {}

	readDailyNotes(): CompanionPluginRead<DailyNotesPluginState> {
		// A foreign object may throw from a getter or from the registry's own
		// method. That must surface as a mismatch the settings tab can report,
		// never as an exception that aborts rendering the whole tab.
		try {
			return this.narrowDailyNotes();
		} catch (error) {
			return mismatch(`Reading the core Daily Notes plugin failed: ${describe(error)}`);
		}
	}

	disableDailyNotes(): CompanionPluginAction {
		try {
			const found = this.findDailyNotes();
			if (!found.ok) return { ok: false, problem: found.problem };

			const plugin = found.value;
			const hostDisable = plugin["disable"];
			if (typeof hostDisable !== "function") {
				return { ok: false, problem: "The core Daily Notes plugin exposes no 'disable' method." };
			}

			(hostDisable as (this: unknown, confirm: boolean) => void).call(plugin, true);
			return { ok: true };
		} catch (error) {
			return { ok: false, problem: `Disabling the core Daily Notes plugin failed: ${describe(error)}` };
		}
	}

	/**
	 * Resolves the companion plugin object. Each hop is read exactly once and
	 * the read value is what gets used, so a getter-backed or changing property
	 * cannot validate on one read and differ on the next.
	 */
	private findDailyNotes(): CompanionPluginRead<Record<string, unknown>> {
		// App's public type carries no internal plugin registry, so the hop goes
		// through unknown rather than any: nothing below is trusted until narrowed.
		const registry: unknown = (this.app as unknown as Record<string, unknown>)["internalPlugins"];

		// Only a missing registry is ordinary absence. One that exists in another
		// shape means this code is wrong about the host it runs in.
		if (registry === undefined || registry === null) {
			return absent("Obsidian exposed no internal plugin registry to read Daily Notes from.");
		}
		if (!isRecord(registry)) {
			return mismatch("Obsidian's internal plugin registry is not an object.");
		}

		const lookup = registry["getPluginById"];
		if (typeof lookup !== "function") {
			return mismatch("Obsidian's internal plugin registry exposes no 'getPluginById' method.");
		}

		// Called on the registry, because the host's own method may read state
		// from its receiver.
		const plugin: unknown = (lookup as (this: unknown, id: string) => unknown).call(registry, DAILY_NOTES_ID);
		if (plugin === undefined || plugin === null) {
			return absent("The core Daily Notes plugin is not installed.");
		}
		if (!isRecord(plugin)) {
			return mismatch("The core Daily Notes plugin is not an object.");
		}

		return { ok: true, value: plugin };
	}

	private narrowDailyNotes(): CompanionPluginRead<DailyNotesPluginState> {
		const found = this.findDailyNotes();
		if (!found.ok) return found;

		const plugin = found.value;
		const enabled = plugin["enabled"];
		if (typeof enabled !== "boolean") {
			return mismatch("The core Daily Notes plugin reported no usable 'enabled' flag.");
		}

		// AC-MIG-01.6: a disabled plugin holds no settings instance, so the answer
		// stops here rather than failing on options that legitimately do not exist.
		if (!enabled) return { ok: true, value: { enabled: false } };

		if (typeof plugin["disable"] !== "function") {
			return mismatch("The core Daily Notes plugin exposes no 'disable' method.");
		}

		const instance = plugin["instance"];
		if (!isRecord(instance)) {
			return mismatch("The core Daily Notes plugin exposes no settings instance.");
		}

		const options = instance["options"];
		if (!isRecord(options)) {
			return mismatch("The core Daily Notes plugin exposes no options record.");
		}

		// AC-ARCH-07.2: whatever the container is, it is read through its own API.
		const published = readStateContainer(options);
		if (!published.ok) return published;

		const settings: Record<SettingKey, string> = { format: "", folder: "", template: "" };
		for (const key of SETTING_KEYS) {
			const value = published.value[key];
			// An unstored value is ordinary and falls back downstream (AC-MIG-01.3),
			// but a value of the wrong type is a wrong assumption and is refused.
			if (value === undefined || value === null) continue;
			if (typeof value !== "string") {
				return mismatch(`The core Daily Notes plugin stored a non-string '${key}'.`);
			}
			settings[key] = value;
		}

		return { ok: true, value: { enabled: true, ...settings } };
	}
}
