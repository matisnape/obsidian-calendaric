import { describe, it, expect, vi } from "vitest";
import {
	isDailyNotesPluginEnabled,
	getLegacyDailyNoteSettings,
	disableDailyNotesPlugin,
	shouldOfferDailyNotesImport,
	planDailyNotesImport,
	applyDailyNotesImport,
	DEFAULT_DAY_FORMAT,
} from "./dailyNotesImport";
import type { DailyNotesImportTarget } from "./dailyNotesImport";
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

describe("shouldOfferDailyNotesImport", () => {
	it("offers the import when the plugin is enabled and nothing was imported yet", () => {
		expect(shouldOfferDailyNotesImport(makeApp({ enabled: true }), makeTarget())).toBe(true);
	});

	it("does not offer the import when the plugin is disabled", () => {
		expect(shouldOfferDailyNotesImport(makeApp({ enabled: false }), makeTarget())).toBe(false);
	});

	it("does not offer the import when the plugin is absent", () => {
		expect(shouldOfferDailyNotesImport(makeApp(undefined), makeTarget())).toBe(false);
	});

	it("does not offer the import again once it has completed", () => {
		expect(shouldOfferDailyNotesImport(makeApp({ enabled: true }), makeTarget({}, true))).toBe(false);
	});
});

describe("planDailyNotesImport", () => {
	const legacy = { format: "DD-MM-YYYY", folder: "Journal", template: "templates/daily" };

	it("treats every field as an addition when the day config is empty", () => {
		const plan = planDailyNotesImport(legacy, makeTarget().day);
		expect(plan.additions.map((f) => f.key)).toEqual(["format", "folder", "templatePath"]);
		expect(plan.conflicts).toEqual([]);
	});

	it("carries the incoming value on each planned field", () => {
		const plan = planDailyNotesImport(legacy, makeTarget().day);
		expect(plan.additions.map((f) => f.incoming)).toEqual(["DD-MM-YYYY", "Journal", "templates/daily"]);
	});

	it("substitutes the documented default format when the stored format is empty", () => {
		const plan = planDailyNotesImport({ ...legacy, format: "" }, makeTarget().day);
		const format = plan.additions.find((f) => f.key === "format");
		expect(format?.incoming).toBe(DEFAULT_DAY_FORMAT);
		expect(DEFAULT_DAY_FORMAT).toBe("YYYY-MM-DD");
	});

	it("reports a field the user already filled differently as a conflict", () => {
		const plan = planDailyNotesImport(legacy, makeTarget({ folder: "Diary" }).day);
		expect(plan.conflicts.map((f) => f.key)).toEqual(["folder"]);
		expect(plan.conflicts[0]).toMatchObject({ current: "Diary", incoming: "Journal" });
		expect(plan.additions.map((f) => f.key)).toEqual(["format", "templatePath"]);
	});

	it("skips a field whose current value already equals the incoming value", () => {
		const plan = planDailyNotesImport(legacy, makeTarget({ format: "DD-MM-YYYY" }).day);
		expect(plan.additions.map((f) => f.key)).toEqual(["folder", "templatePath"]);
		expect(plan.conflicts).toEqual([]);
	});

	it("labels every planned field for display", () => {
		const plan = planDailyNotesImport(legacy, makeTarget({ folder: "Diary" }).day);
		for (const field of [...plan.additions, ...plan.conflicts]) {
			expect(field.label.length).toBeGreaterThan(0);
		}
	});
});

describe("applyDailyNotesImport", () => {
	const legacy = { format: "DD-MM-YYYY", folder: "Journal", template: "templates/daily" };

	it("copies folder, format and template, enables day, and records the import", () => {
		const target = makeTarget();
		expect(applyDailyNotesImport(target, legacy)).toBe(true);
		expect(target.day).toEqual({
			enabled: true,
			format: "DD-MM-YYYY",
			folder: "Journal",
			templatePath: "templates/daily",
		});
		expect(target.hasMigratedDailyNoteSettings).toBe(true);
	});

	it("writes the documented default format when the stored format is empty", () => {
		const target = makeTarget();
		applyDailyNotesImport(target, { ...legacy, format: "" });
		expect(target.day.format).toBe(DEFAULT_DAY_FORMAT);
	});

	it("leaves folder, format and template unchanged when the import already completed", () => {
		const target = makeTarget({ format: "YYYY", folder: "Mine", templatePath: "t" }, true);
		expect(applyDailyNotesImport(target, legacy)).toBe(false);
		expect(target.day).toEqual({ enabled: false, format: "YYYY", folder: "Mine", templatePath: "t" });
	});

	it("keeps a conflicting value the user did not confirm", () => {
		const target = makeTarget({ folder: "Diary" });
		applyDailyNotesImport(target, legacy);
		expect(target.day.folder).toBe("Diary");
		expect(target.day.format).toBe("DD-MM-YYYY");
	});

	it("replaces a conflicting value the user confirmed", () => {
		const target = makeTarget({ folder: "Diary" });
		applyDailyNotesImport(target, legacy, ["folder"]);
		expect(target.day.folder).toBe("Journal");
	});

	it("records the import even when every conflict was declined", () => {
		const target = makeTarget({ format: "YYYY", folder: "Diary", templatePath: "mine" });
		applyDailyNotesImport(target, legacy);
		expect(target.hasMigratedDailyNoteSettings).toBe(true);
		expect(target.day.enabled).toBe(true);
	});
});

function makeTarget(day: Partial<DailyNotesImportTarget["day"]> = {}, imported = false): DailyNotesImportTarget {
	return {
		hasMigratedDailyNoteSettings: imported,
		day: { enabled: false, format: "", folder: "", templatePath: "", ...day },
	};
}
