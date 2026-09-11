import { describe, it, expect, vi } from "vitest";
import {
	decideDailyNotesCard,
	recordCompanionDisabled,
	planDailyNotesImport,
	applyDailyNotesImport,
	DEFAULT_DAY_FORMAT,
} from "./dailyNotesImport";
import type { DailyNotesImportTarget } from "./dailyNotesImport";
import type {
	CompanionPluginPort,
	CompanionPluginRead,
	DailyNotesPluginState,
} from "../adapters/companionPluginPort";
import { ObsidianCompanionPluginAdapter } from "../adapters/obsidianCompanionPluginAdapter";
import type { App } from "obsidian";

/** The enabled arm of the port's state union, which the helpers below build. */
type EnabledState = Extract<DailyNotesPluginState, { enabled: true }>;

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

describe("decideDailyNotesCard", () => {
	function port(read: CompanionPluginRead<DailyNotesPluginState>): CompanionPluginPort {
		return { readDailyNotes: () => read, disableDailyNotes: vi.fn() };
	}

	function readable(over: Partial<Omit<EnabledState, "enabled">> = {}): CompanionPluginPort {
		return port({
			ok: true,
			value: {
				enabled: true,
				format: "DD-MM-YYYY",
				folder: "Journal",
				template: "templates/daily",
				...over,
			},
		});
	}

	const disabled = port({ ok: true, value: { enabled: false } });

	it("hides the card when the companion plugin is absent (AC-MIG-01.6)", () => {
		const card = decideDailyNotesCard(port({ ok: false, reason: "absent", problem: "gone" }), makeTarget());
		expect(card.kind).toBe("hidden");
	});

	it("hides the card when the companion plugin is installed but off (AC-MIG-01.6)", () => {
		expect(decideDailyNotesCard(disabled, makeTarget()).kind).toBe("hidden");
	});

	// AC-MIG-01.6 through the real adapter: a disabled core plugin carries no
	// settings instance, and that must read as "hide", never as "broken".
	it("hides the card for a disabled plugin that exposes no settings instance", () => {
		const app = {
			internalPlugins: { getPluginById: () => ({ enabled: false }) },
		} as unknown as App;
		const card = decideDailyNotesCard(new ObsidianCompanionPluginAdapter(app), makeTarget());
		expect(card.kind).toBe("hidden");
	});

	it("still hides the card for a disabled plugin once the import has run", () => {
		expect(decideDailyNotesCard(disabled, makeTarget({}, true)).kind).toBe("hidden");
	});

	// AC-ARCH-04.4: a mismatch surfaces as an explicit problem, never as a silent
	// empty import that looks like it worked.
	it("reports the problem when the companion plugin does not match the expected shape", () => {
		const card = decideDailyNotesCard(
			port({ ok: false, reason: "mismatch", problem: "options sit behind a 'subscribe' accessor" }),
			makeTarget(),
		);
		expect(card.kind).toBe("unreadable");
		if (card.kind !== "unreadable") return;
		expect(card.problem).toBe("options sit behind a 'subscribe' accessor");
	});

	it("offers the import with the narrowed values when nothing was imported yet", () => {
		const card = decideDailyNotesCard(readable(), makeTarget());
		expect(card.kind).toBe("offer");
		if (card.kind !== "offer") return;
		expect(card.legacy).toEqual({ format: "DD-MM-YYYY", folder: "Journal", template: "templates/daily" });
	});

	it("shows the still-active notice once the import has run (AC-MIG-01.4)", () => {
		const card = decideDailyNotesCard(readable(), makeTarget({}, true));
		expect(card.kind).toBe("still-active");
	});

	// AC-ARCH-04.4: a companion plugin that throws is reported, and the card
	// carries the problem instead of the settings tab failing to render.
	it("reports the problem when the companion plugin throws on read", () => {
		const throwing = {
			internalPlugins: {
				getPluginById: () => {
					throw new Error("registry exploded");
				},
			},
		} as unknown as App;
		const card = decideDailyNotesCard(new ObsidianCompanionPluginAdapter(throwing), makeTarget());
		expect(card.kind).toBe("unreadable");
		if (card.kind !== "unreadable") return;
		expect(card.problem).toMatch(/exploded/);
	});

	it("never reports an importable offer without a readable companion plugin", () => {
		for (const read of [
			{ ok: false, reason: "absent", problem: "p" } as const,
			{ ok: false, reason: "mismatch", problem: "p" } as const,
		]) {
			expect(decideDailyNotesCard(port(read), makeTarget()).kind).not.toBe("offer");
		}
	});
});

// AC-ARCH-04.4 applied to a write: a disable that did not happen must not be
// recorded as one, because recording it removes the import offer for good.
describe("recordCompanionDisabled", () => {
	it("records the migration when the companion plugin was disabled", () => {
		const target = makeTarget();
		expect(recordCompanionDisabled(target, { ok: true })).toBe(true);
		expect(target.hasMigratedDailyNoteSettings).toBe(true);
	});

	it("records nothing when disabling failed", () => {
		const target = makeTarget();
		expect(recordCompanionDisabled(target, { ok: false, problem: "host refused" })).toBe(false);
		expect(target.hasMigratedDailyNoteSettings).toBe(false);
	});

	it("leaves an already recorded migration alone when disabling failed", () => {
		const target = makeTarget({}, true);
		expect(recordCompanionDisabled(target, { ok: false, problem: "host refused" })).toBe(false);
		expect(target.hasMigratedDailyNoteSettings).toBe(true);
	});
});

describe("ObsidianCompanionPluginAdapter.disableDailyNotes outcome", () => {
	function appWith(plugin: unknown): App {
		return { internalPlugins: { getPluginById: () => plugin } } as unknown as App;
	}

	it("reports success when the host disabled the plugin", () => {
		const outcome = new ObsidianCompanionPluginAdapter(
			appWith({ enabled: true, instance: { options: {} }, disable: vi.fn() }),
		).disableDailyNotes();
		expect(outcome.ok).toBe(true);
	});

	it("reports the problem when the host throws", () => {
		const outcome = new ObsidianCompanionPluginAdapter(
			appWith({
				enabled: true,
				instance: { options: {} },
				disable: () => {
					throw new Error("host refused");
				},
			}),
		).disableDailyNotes();
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.problem).toMatch(/host refused/);
	});

	it("reports the problem when the plugin is gone", () => {
		const outcome = new ObsidianCompanionPluginAdapter(appWith(null)).disableDailyNotes();
		expect(outcome.ok).toBe(false);
	});

	it("reports the problem when the plugin exposes no disable method", () => {
		const outcome = new ObsidianCompanionPluginAdapter(
			appWith({ enabled: true, instance: { options: {} } }),
		).disableDailyNotes();
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.problem).toMatch(/disable/);
	});
});
