import type { App } from "obsidian";
import type { CompanionPluginRead } from "./companionPluginPort";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function absent<T>(problem: string): CompanionPluginRead<T> {
	return { ok: false, reason: "absent", problem };
}

function mismatch<T>(problem: string): CompanionPluginRead<T> {
	return { ok: false, reason: "mismatch", problem };
}

/**
 * Resolves an enabled community plugin by the first of `ids` the registry
 * answers for. The registry lists only plugins that are loaded, so a plugin
 * that is installed but switched off reads as absent -- which is what every
 * caller means by "not enabled".
 *
 * Each hop is read exactly once and the read value is what gets used, so a
 * getter-backed property cannot validate on one read and differ on the next.
 * Its own module because two adapters probe this registry, and an adapter
 * importing another adapter is wiring only src/main.ts may do (AC-ARCH-01.1).
 */
export function findCommunityPlugin(
	app: App,
	ids: readonly string[],
	name: string,
): CompanionPluginRead<Record<string, unknown>> {
	// App's public type carries no community plugin registry, so the hop goes
	// through unknown rather than any: nothing below is trusted until narrowed.
	const registry: unknown = (app as unknown as Record<string, unknown>)["plugins"];

	// Only a missing registry is ordinary absence. One that exists in another
	// shape means this code is wrong about the host it runs in.
	if (registry === undefined || registry === null) {
		return absent(`Obsidian exposed no community plugin registry to read ${name} from.`);
	}
	if (!isRecord(registry)) {
		return mismatch("Obsidian's community plugin registry is not an object.");
	}

	const lookup = registry["getPlugin"];
	if (typeof lookup !== "function") {
		return mismatch("Obsidian's community plugin registry exposes no 'getPlugin' method.");
	}

	for (const id of ids) {
		// Called on the registry, because the host's own method reads state
		// from its receiver.
		const plugin: unknown = (lookup as (this: unknown, id: string) => unknown).call(registry, id);
		if (plugin === undefined || plugin === null) continue;
		if (!isRecord(plugin)) {
			return mismatch(`The ${name} plugin registered as '${id}' is not an object.`);
		}
		return { ok: true, value: plugin };
	}

	return absent(`The ${name} plugin is not installed.`);
}
