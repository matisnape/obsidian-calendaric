import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { ObsidianNaturalDatesAdapter } from "./obsidianNaturalDatesAdapter";

function makeApp(plugins: Record<string, unknown>): App {
	return { plugins: { getPlugin: (id: string) => plugins[id] ?? null } } as unknown as App;
}

/** The plugin's parseDate answers with an object whose `date` is invalid when the phrase names none. */
function nldates(known: Record<string, string>) {
	const plugin = {
		parseDate(this: unknown, phrase: string) {
			if (this !== plugin) throw new Error("parseDate called off its plugin");
			const iso = known[phrase];
			return { date: new Date(iso === undefined ? Number.NaN : `${iso}T12:00:00`) };
		},
	};
	return plugin;
}

describe("ObsidianNaturalDatesAdapter", () => {
	it("is available while the plugin is enabled and exposes parseDate", () => {
		expect(new ObsidianNaturalDatesAdapter(makeApp({ "nldates-obsidian": nldates({}) })).isAvailable()).toBe(true);
	});

	it("is unavailable when the plugin is missing or disabled, which the registry reports the same way", () => {
		expect(new ObsidianNaturalDatesAdapter(makeApp({})).isAvailable()).toBe(false);
		expect(new ObsidianNaturalDatesAdapter({} as App).isAvailable()).toBe(false);
	});

	it("is unavailable when the plugin no longer has parseDate", () => {
		expect(new ObsidianNaturalDatesAdapter(makeApp({ "nldates-obsidian": {} })).isAvailable()).toBe(false);
	});

	it("returns the date a phrase names, and null for one it does not recognise", () => {
		const adapter = new ObsidianNaturalDatesAdapter(makeApp({ "nldates-obsidian": nldates({ "last monday": "2026-11-02" }) }));

		expect(adapter.parseDate("last monday")?.getDate()).toBe(2);
		expect(adapter.parseDate("purple elephant")).toBeNull();
	});

	it("returns null instead of throwing when the plugin is gone or its parser fails", () => {
		const throwing = { parseDate: () => { throw new Error("boom"); } };

		expect(new ObsidianNaturalDatesAdapter(makeApp({})).parseDate("today")).toBeNull();
		expect(new ObsidianNaturalDatesAdapter(makeApp({ "nldates-obsidian": throwing })).parseDate("today")).toBeNull();
	});
});
