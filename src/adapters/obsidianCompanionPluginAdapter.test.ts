import { describe, it, expect, vi } from "vitest";
import type { App } from "obsidian";
import { ObsidianCompanionPluginAdapter } from "./obsidianCompanionPluginAdapter";

function makeApp(plugin: unknown): App {
	return {
		internalPlugins: {
			getPluginById: (_id: string) => plugin,
		},
	} as unknown as App;
}

/** A plugin object shaped the way an enabled core Daily Notes plugin really is. */
function validPlugin(options: unknown = { format: "DD-MM-YYYY", folder: "Journal", template: "t/daily" }) {
	return { enabled: true, instance: { options }, disable: vi.fn() };
}

describe("ObsidianCompanionPluginAdapter.readDailyNotes", () => {
	it("narrows a well-shaped plugin to the depended-on fields", () => {
		const read = new ObsidianCompanionPluginAdapter(makeApp(validPlugin())).readDailyNotes();
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.value).toMatchObject({
			enabled: true,
			format: "DD-MM-YYYY",
			folder: "Journal",
			template: "t/daily",
		});
	});

	it("reports the plugin as absent when the host has no internalPlugins registry", () => {
		const read = new ObsidianCompanionPluginAdapter({} as unknown as App).readDailyNotes();
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.reason).toBe("absent");
		expect(read.problem).toMatch(/registry/i);
	});

	it("reports the plugin as absent when the registry returns nothing", () => {
		const read = new ObsidianCompanionPluginAdapter(makeApp(null)).readDailyNotes();
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.reason).toBe("absent");
		expect(read.problem).toMatch(/not installed/i);
	});

	// AC-ARCH-04.4: a missing method is a shape mismatch, not a no-op.
	it("reports a mismatch when the disable method is missing", () => {
		const plugin = validPlugin();
		delete (plugin as { disable?: unknown }).disable;
		const read = new ObsidianCompanionPluginAdapter(makeApp(plugin)).readDailyNotes();
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.reason).toBe("mismatch");
		expect(read.problem).toMatch(/disable/);
	});

	// AC-ARCH-04.4: the defect this story was written for — a state container that
	// needs an accessor, read as if it were a plain record of values.
	it("reports a mismatch when the options container requires a subscribe accessor", () => {
		const read = new ObsidianCompanionPluginAdapter(
			makeApp(validPlugin({ subscribe: () => () => undefined })),
		).readDailyNotes();
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.reason).toBe("mismatch");
		expect(read.problem).toMatch(/accessor/i);
	});

	it("reports a mismatch when the options container requires a get accessor", () => {
		const read = new ObsidianCompanionPluginAdapter(
			makeApp(validPlugin({ get: () => ({ format: "YYYY" }) })),
		).readDailyNotes();
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.reason).toBe("mismatch");
		expect(read.problem).toMatch(/accessor/i);
	});

	it("reports a mismatch when the instance is absent", () => {
		const read = new ObsidianCompanionPluginAdapter(
			makeApp({ enabled: true, disable: vi.fn() }),
		).readDailyNotes();
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.reason).toBe("mismatch");
		expect(read.problem).toMatch(/instance|options/i);
	});

	it("reports a mismatch when the options record is absent", () => {
		const read = new ObsidianCompanionPluginAdapter(
			makeApp({ enabled: true, instance: {}, disable: vi.fn() }),
		).readDailyNotes();
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.reason).toBe("mismatch");
		expect(read.problem).toMatch(/options/i);
	});

	it("reports a mismatch when enabled is not a boolean", () => {
		const read = new ObsidianCompanionPluginAdapter(
			makeApp({ enabled: "yes", instance: { options: {} }, disable: vi.fn() }),
		).readDailyNotes();
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.reason).toBe("mismatch");
		expect(read.problem).toMatch(/enabled/);
	});

	// AC-MIG-01.3 stays intact: a configured plugin that stored no values is a
	// valid read whose empty strings the import layer replaces with defaults.
	it("accepts an empty options record and reports empty values", () => {
		const read = new ObsidianCompanionPluginAdapter(makeApp(validPlugin({}))).readDailyNotes();
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.value).toMatchObject({ format: "", folder: "", template: "" });
	});

	it("drops a non-string value instead of passing it through", () => {
		const read = new ObsidianCompanionPluginAdapter(
			makeApp(validPlugin({ format: 7, folder: "Journal" })),
		).readDailyNotes();
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.value.format).toBe("");
		expect(read.value.folder).toBe("Journal");
	});

	it("exposes disable as a no-argument call that confirms on the host", () => {
		const plugin = validPlugin();
		const read = new ObsidianCompanionPluginAdapter(makeApp(plugin)).readDailyNotes();
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		read.value.disable();
		expect(plugin.disable).toHaveBeenCalledWith(true);
	});

	it("reads the daily-notes plugin id", () => {
		const getPluginById = vi.fn(() => validPlugin());
		const app = { internalPlugins: { getPluginById } } as unknown as App;
		new ObsidianCompanionPluginAdapter(app).readDailyNotes();
		expect(getPluginById).toHaveBeenCalledWith("daily-notes");
	});
});
