import { describe, it, expect, vi } from "vitest";
import {
	isDailyNotesPluginEnabled,
	getLegacyDailyNoteSettings,
	disableDailyNotesPlugin,
} from "./dailyNotesImport";
import type { App } from "obsidian";

function makeApp(pluginOverride?: object): App {
	return {
		internalPlugins: {
			getPluginById: (_id: string) => pluginOverride ?? null,
		},
	} as unknown as App;
}

// ── isDailyNotesPluginEnabled ────────────────────────────────────────────────

describe("isDailyNotesPluginEnabled", () => {
	it("returns true when the plugin is enabled", () => {
		const app = makeApp({ enabled: true });
		expect(isDailyNotesPluginEnabled(app)).toBe(true);
	});

	it("returns false when the plugin is disabled", () => {
		const app = makeApp({ enabled: false });
		expect(isDailyNotesPluginEnabled(app)).toBe(false);
	});

	it("returns false when the plugin is not found", () => {
		const app = makeApp(undefined);
		expect(isDailyNotesPluginEnabled(app)).toBe(false);
	});

	it("returns false when internalPlugins is absent", () => {
		const app = { internalPlugins: null } as unknown as App;
		expect(isDailyNotesPluginEnabled(app)).toBe(false);
	});
});

// ── getLegacyDailyNoteSettings ───────────────────────────────────────────────

describe("getLegacyDailyNoteSettings", () => {
	it("returns stored format, folder, and template when all are set", () => {
		const app = makeApp({
			enabled: true,
			instance: {
				options: {
					format: "DD-MM-YYYY",
					folder: "Journal",
					template: "templates/daily",
				},
			},
		});
		expect(getLegacyDailyNoteSettings(app)).toEqual({
			format: "DD-MM-YYYY",
			folder: "Journal",
			template: "templates/daily",
		});
	});

	it("returns empty strings when options object is missing", () => {
		const app = makeApp({ enabled: true, instance: {} });
		expect(getLegacyDailyNoteSettings(app)).toEqual({
			format: "",
			folder: "",
			template: "",
		});
	});

	it("returns empty strings when instance is missing", () => {
		const app = makeApp({ enabled: true });
		expect(getLegacyDailyNoteSettings(app)).toEqual({
			format: "",
			folder: "",
			template: "",
		});
	});

	it("returns empty strings when the plugin is not found", () => {
		const app = makeApp(undefined);
		expect(getLegacyDailyNoteSettings(app)).toEqual({
			format: "",
			folder: "",
			template: "",
		});
	});

	it("returns empty string for format when only folder and template are set", () => {
		const app = makeApp({
			enabled: true,
			instance: { options: { folder: "Notes", template: "tmpl" } },
		});
		const result = getLegacyDailyNoteSettings(app);
		expect(result.format).toBe("");
		expect(result.folder).toBe("Notes");
		expect(result.template).toBe("tmpl");
	});
});

// ── disableDailyNotesPlugin ──────────────────────────────────────────────────

describe("disableDailyNotesPlugin", () => {
	it("calls disable(true) on the plugin", () => {
		const disable = vi.fn();
		const app = makeApp({ enabled: true, disable });
		disableDailyNotesPlugin(app);
		expect(disable).toHaveBeenCalledOnce();
		expect(disable).toHaveBeenCalledWith(true);
	});

	it("does not throw when the plugin is not found", () => {
		const app = makeApp(undefined);
		expect(() => disableDailyNotesPlugin(app)).not.toThrow();
	});
});
