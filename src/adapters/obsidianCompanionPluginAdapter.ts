import type { App } from "obsidian";
import type { CompanionPluginPort, CompanionPluginRead, DailyNotesPluginState } from "./companionPluginPort";

const DAILY_NOTES_ID = "daily-notes";

/**
 * Names the accessor contracts a state container uses instead of exposing its
 * values directly. Reading such a container as a plain record yields undefined
 * for every field, which is how a feature can ship broken for every user while
 * every call appears to succeed.
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

	disableDailyNotes(): void {
		try {
			const plugin = this.findDailyNotes();
			if (!isRecord(plugin)) return;
			const hostDisable = plugin["disable"];
			if (typeof hostDisable !== "function") return;
			(hostDisable as (this: unknown, confirm: boolean) => void).call(plugin, true);
		} catch (error) {
			// The button that calls this exists only because a read just succeeded,
			// so a failure here means the plugin changed underneath. The settings
			// tab re-renders straight after and drops the card, which reports it.
			console.error("Calendaric: the core Daily Notes plugin could not be disabled", error);
		}
	}

	/** Looks the companion plugin up, preserving the registry as the receiver. */
	private findDailyNotes(): unknown {
		// App's public type carries no internal plugin registry, so the hop goes
		// through unknown rather than any: nothing below is trusted until narrowed.
		const registry: unknown = (this.app as unknown as Record<string, unknown>)["internalPlugins"];
		if (!isRecord(registry)) return undefined;

		const lookup = registry["getPluginById"];
		if (typeof lookup !== "function") return undefined;

		// Called on the registry, because the host's own method may read state
		// from its receiver.
		return (lookup as (this: unknown, id: string) => unknown).call(registry, DAILY_NOTES_ID);
	}

	private narrowDailyNotes(): CompanionPluginRead<DailyNotesPluginState> {
		const registry: unknown = (this.app as unknown as Record<string, unknown>)["internalPlugins"];

		// Only a missing registry is ordinary absence. One that exists in another
		// shape means this code is wrong about the host it runs in.
		if (registry === undefined || registry === null) {
			return absent("Obsidian exposed no internal plugin registry to read Daily Notes from.");
		}
		if (!isRecord(registry)) {
			return mismatch("Obsidian's internal plugin registry is not an object.");
		}
		if (typeof registry["getPluginById"] !== "function") {
			return mismatch("Obsidian's internal plugin registry exposes no 'getPluginById' method.");
		}

		const plugin = this.findDailyNotes();
		if (plugin === undefined || plugin === null) {
			return absent("The core Daily Notes plugin is not installed.");
		}
		if (!isRecord(plugin)) {
			return mismatch("The core Daily Notes plugin is not an object.");
		}

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

		const accessor = ACCESSOR_KEYS.find((key) => typeof options[key] === "function");
		if (accessor !== undefined) {
			return mismatch(
				`The core Daily Notes plugin stores its options behind a '${accessor}' accessor, not as readable values.`,
			);
		}

		const settings: Record<SettingKey, string> = { format: "", folder: "", template: "" };
		for (const key of SETTING_KEYS) {
			const value = options[key];
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
