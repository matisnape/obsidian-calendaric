import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { ObsidianCalendarPluginAdapter } from "./obsidianCalendarPluginAdapter";

function makeApp(plugins: Record<string, unknown>): App {
	return {
		plugins: {
			getPlugin: (id: string) => plugins[id] ?? null,
		},
	} as unknown as App;
}

/**
 * A Calendar plugin shaped the way the surveyed one is (its src/main.ts):
 * `options` mirrors the settings store, and `writeOptions` patches the store
 * and then saves -- in that order, so a failed save leaves memory patched.
 * `disk` is its data.json, which `loadData` reads back.
 */
function calendarPlugin(showWeeklyNote: unknown, save: "works" | "rejects" | "drops" = "works") {
	type Options = Record<string, unknown>;
	const disk = { data: { showWeeklyNote, weekStart: "monday" } as Options };
	const plugin: {
		options: Options;
		writeOptions(change: (current: Options) => Options): Promise<void>;
		loadData(): Promise<Options>;
	} = {
		options: { showWeeklyNote, weekStart: "monday" },
		async writeOptions(change) {
			if (this !== plugin) throw new Error("writeOptions called off its plugin");
			this.options = { ...this.options, ...change(this.options) };
			if (save === "rejects") throw new Error("disk full");
			if (save === "works") disk.data = { ...this.options };
		},
		async loadData() {
			return { ...disk.data };
		},
	};
	return { plugin, disk };
}

describe("ObsidianCalendarPluginAdapter.readCalendarWeeklyNotes", () => {
	it("AC-MIG-06.3: detects the Calendar plugin under its published id", () => {
		const { plugin } = calendarPlugin(true);
		const result = new ObsidianCalendarPluginAdapter(makeApp({ calendar: plugin })).readCalendarWeeklyNotes();

		expect(result).toEqual({ ok: true, value: true });
	});

	it("AC-MIG-06.3: detects the Calendar plugin under its development-build id", () => {
		const { plugin } = calendarPlugin(true);
		const result = new ObsidianCalendarPluginAdapter(makeApp({ "calendar-anks": plugin })).readCalendarWeeklyNotes();

		expect(result).toEqual({ ok: true, value: true });
	});

	it("AC-MIG-06.3: prefers the development build when both are installed", () => {
		const dev = calendarPlugin(false).plugin;
		const store = calendarPlugin(true).plugin;
		const result = new ObsidianCalendarPluginAdapter(
			makeApp({ "calendar-anks": dev, calendar: store }),
		).readCalendarWeeklyNotes();

		expect(result).toEqual({ ok: true, value: false });
	});

	it("reports weekly notes off when the plugin has week numbers off", () => {
		const { plugin } = calendarPlugin(false);

		expect(new ObsidianCalendarPluginAdapter(makeApp({ calendar: plugin })).readCalendarWeeklyNotes()).toEqual({
			ok: true,
			value: false,
		});
	});

	it("reports a mismatch when the setting is not a boolean", () => {
		const { plugin } = calendarPlugin("yes");
		const result = new ObsidianCalendarPluginAdapter(makeApp({ calendar: plugin })).readCalendarWeeklyNotes();

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("mismatch");
	});

	it("AC-MIG-06.4: reports absence when neither id is enabled", () => {
		const result = new ObsidianCalendarPluginAdapter(makeApp({})).readCalendarWeeklyNotes();

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("absent");
	});

	it("AC-MIG-06.4: reports absence when the host exposes no plugin registry", () => {
		const result = new ObsidianCalendarPluginAdapter({} as unknown as App).readCalendarWeeklyNotes();

		expect(result.ok).toBe(false);
	});

	it("AC-MIG-06.4: does not throw when the registry itself throws", () => {
		const app = {
			plugins: {
				getPlugin: () => {
					throw new Error("registry exploded");
				},
			},
		} as unknown as App;

		const adapter = new ObsidianCalendarPluginAdapter(app);
		expect(() => adapter.readCalendarWeeklyNotes()).not.toThrow();
		expect(adapter.readCalendarWeeklyNotes().ok).toBe(false);
	});
});

describe("ObsidianCalendarPluginAdapter.disableCalendarWeeklyNotes", () => {
	it("AC-MIG-06.5: turns week numbers off through the plugin's writeOptions, which saves it", async () => {
		const { plugin, disk } = calendarPlugin(true);
		const adapter = new ObsidianCalendarPluginAdapter(makeApp({ "calendar-anks": plugin }));

		expect(await adapter.disableCalendarWeeklyNotes()).toEqual({ ok: true });

		expect(adapter.readCalendarWeeklyNotes()).toEqual({ ok: true, value: false });
		expect(disk.data).toEqual({ showWeeklyNote: false, weekStart: "monday" });
	});

	it("AC-MIG-06.6: reports a save that never reached data.json as a failed write", async () => {
		const { plugin } = calendarPlugin(true, "drops");
		const adapter = new ObsidianCalendarPluginAdapter(makeApp({ calendar: plugin }));

		const result = await adapter.disableCalendarWeeklyNotes();

		// Memory says off, which is exactly what must not count.
		expect(adapter.readCalendarWeeklyNotes()).toEqual({ ok: true, value: false });
		expect(result.ok).toBe(false);
	});

	it("AC-MIG-06.6: reports a plugin with no writeOptions instead of claiming the write", async () => {
		const adapter = new ObsidianCalendarPluginAdapter(makeApp({ calendar: { options: { showWeeklyNote: true } } }));

		expect((await adapter.disableCalendarWeeklyNotes()).ok).toBe(false);
	});

	it("AC-MIG-06.6: reports a writeOptions whose save rejects as a failed write, never a throw", async () => {
		const { plugin } = calendarPlugin(true, "rejects");
		const adapter = new ObsidianCalendarPluginAdapter(makeApp({ calendar: plugin }));

		const result = await adapter.disableCalendarWeeklyNotes();

		expect(adapter.readCalendarWeeklyNotes()).toEqual({ ok: true, value: false });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.problem).toContain("disk full");
	});
});
