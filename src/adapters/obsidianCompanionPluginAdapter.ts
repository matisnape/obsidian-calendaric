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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	return typeof value === "string" ? value : "";
}

function absent<T>(problem: string): CompanionPluginRead<T> {
	return { ok: false, reason: "absent", problem };
}

function mismatch<T>(problem: string): CompanionPluginRead<T> {
	return { ok: false, reason: "mismatch", problem };
}

/**
 * The only place the plugin reaches into Obsidian's undocumented internal
 * plugin registry. Every field is narrowed here, so callers receive a value
 * that already matches DailyNotesPluginState or an explicit problem.
 */
export class ObsidianCompanionPluginAdapter implements CompanionPluginPort {
	constructor(private app: App) {}

	readDailyNotes(): CompanionPluginRead<DailyNotesPluginState> {
		// App's public type carries no internal plugin registry, so the hop goes
		// through unknown rather than any: nothing below is trusted until narrowed.
		const registry: unknown = (this.app as unknown as Record<string, unknown>)["internalPlugins"];
		if (!isRecord(registry) || typeof registry["getPluginById"] !== "function") {
			return absent("Obsidian exposed no internal plugin registry to read Daily Notes from.");
		}

		const lookup = registry["getPluginById"] as (id: string) => unknown;
		const plugin: unknown = lookup(DAILY_NOTES_ID);
		if (!isRecord(plugin)) {
			return absent("The core Daily Notes plugin is not installed.");
		}

		if (typeof plugin["enabled"] !== "boolean") {
			return mismatch("The core Daily Notes plugin reported no usable 'enabled' flag.");
		}
		const enabled = plugin["enabled"];

		if (typeof plugin["disable"] !== "function") {
			return mismatch("The core Daily Notes plugin exposes no 'disable' method.");
		}
		const hostDisable = plugin["disable"] as (confirm: boolean) => void;

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

		return {
			ok: true,
			value: {
				enabled,
				format: readString(options, "format"),
				folder: readString(options, "folder"),
				template: readString(options, "template"),
				disable: () => hostDisable.call(plugin, true),
			},
		};
	}
}
