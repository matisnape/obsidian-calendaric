import { describe, it, expect } from "vitest";
import type {
	CompanionPluginRead,
	PeriodicNotesCalendarSet,
	PeriodicNotesGranularityConfig,
	PeriodicNotesPort,
} from "../adapters/companionPluginPort";
import { DEFAULT_PERIODIC_CONFIG } from "../types";
import type { Granularity } from "../types";
import { GRANULARITIES } from "./model";
import {
	applyPeriodicNotesImport,
	decidePeriodicNotesCard,
	planPeriodicNotesImport,
} from "./periodicNotesImport";
import type { PeriodicNotesImportTarget } from "./periodicNotesImport";

/** One granularity entry of a Periodic Notes calendar set, fields left out defaulted. */
function entry(overrides: Partial<PeriodicNotesGranularityConfig> = {}): PeriodicNotesGranularityConfig {
	return { enabled: true, format: "", folder: "", templatePath: "", allowPrefixMatch: false, ...overrides };
}

function calendarSet(
	granularities: Record<string, PeriodicNotesGranularityConfig>,
	id = "Default",
): PeriodicNotesCalendarSet {
	return { id, granularities };
}

function reader(
	read: CompanionPluginRead<PeriodicNotesCalendarSet>,
): Pick<PeriodicNotesPort, "readActiveCalendarSet"> {
	return { readActiveCalendarSet: () => read };
}

/** Calendaric's five granularity configs, all on the built-in defaults. */
function freshTarget(): PeriodicNotesImportTarget {
	const target = {} as PeriodicNotesImportTarget;
	for (const granularity of GRANULARITIES) {
		target[granularity] = { ...DEFAULT_PERIODIC_CONFIG };
	}
	return target;
}

function targetWith(
	granularity: Granularity,
	overrides: Partial<PeriodicNotesImportTarget[Granularity]>,
): PeriodicNotesImportTarget {
	const target = freshTarget();
	target[granularity] = { ...target[granularity], ...overrides };
	return target;
}

describe("planPeriodicNotesImport / applyPeriodicNotesImport", () => {
	describe("AC-MIG-04.1: the active calendar set's values become Calendaric's", () => {
		it("AC-MIG-04.1: sets folder, format, template and enabled for every granularity the active calendar set enables", () => {
			const target = freshTarget();

			const changed = applyPeriodicNotesImport(
				target,
				calendarSet({
					day: entry({ format: "YYYY-MM-DD", folder: "Journal/Daily", templatePath: "Templates/Day.md" }),
					month: entry({ format: "YYYY-MM", folder: "Journal/Monthly", templatePath: "Templates/Month.md" }),
				}),
			);

			expect(changed).toBe(true);
			expect(target.day).toMatchObject({
				enabled: true,
				format: "YYYY-MM-DD",
				folder: "Journal/Daily",
				templatePath: "Templates/Day.md",
			});
			expect(target.month).toMatchObject({
				enabled: true,
				format: "YYYY-MM",
				folder: "Journal/Monthly",
				templatePath: "Templates/Month.md",
			});
		});

		// DEC-18: this vault's weekly notes are renamed after creation and only
		// resolve through a prefix match, so the flag has to come across too.
		it("AC-MIG-04.1: carries the prefix-match flag across with the rest of the granularity", () => {
			const target = freshTarget();

			applyPeriodicNotesImport(
				target,
				calendarSet({ week: entry({ folder: "Journal/Weekly", allowPrefixMatch: true }) }),
			);

			expect(target.week.allowPrefixMatch).toBe(true);
		});

		// A granularity the active set says nothing about is not "off": it is
		// unconfigured over there, and Calendaric's own value stands.
		it("AC-MIG-04.1: leaves a granularity the active calendar set does not enable untouched", () => {
			const target = targetWith("week", { enabled: true, folder: "Mine/Weekly", format: "gggg-[W]ww" });

			applyPeriodicNotesImport(target, calendarSet({ day: entry({ folder: "Journal" }) }));

			expect(target.week).toMatchObject({ enabled: true, folder: "Mine/Weekly", format: "gggg-[W]ww" });
		});

		it("AC-MIG-04.1: ignores a granularity name this version does not know", () => {
			const target = freshTarget();

			const plan = planPeriodicNotesImport(
				calendarSet({ "fiscal-year": entry({ folder: "Fiscal" }) }),
				target,
			);

			expect(plan.additions).toEqual([]);
			expect(plan.conflicts).toEqual([]);
		});
	});

	describe("AC-MIG-04.4: a customised value is shown, not overwritten", () => {
		it("AC-MIG-04.4: reports the incoming value next to the current one and replaces it only once confirmed", () => {
			const target = targetWith("day", { folder: "Mine/Days", templatePath: "Mine/Day.md" });

			const set = calendarSet({
				day: entry({ folder: "Journal/Daily", templatePath: "Templates/Day.md", format: "YYYY-MM-DD" }),
			});
			const plan = planPeriodicNotesImport(set, target);

			expect(plan.conflicts.map((field) => [field.id, field.current, field.incoming])).toEqual([
				["day.folder", "Mine/Days", "Journal/Daily"],
				["day.templatePath", "Mine/Day.md", "Templates/Day.md"],
			]);
			// Neither the off switch nor the empty format is a customised value, so
			// neither needs confirming.
			expect(plan.additions.map((field) => field.id)).toEqual(["day.enabled", "day.format"]);

			applyPeriodicNotesImport(target, set, ["day.folder"]);

			expect(target.day.folder).toBe("Journal/Daily");
			expect(target.day.templatePath).toBe("Mine/Day.md");
			expect(target.day.format).toBe("YYYY-MM-DD");
		});

		it("AC-MIG-04.4: confirming nothing changes no customised value", () => {
			const target = targetWith("day", { folder: "Mine/Days", format: "DD-MM-YYYY" });

			applyPeriodicNotesImport(target, calendarSet({ day: entry({ folder: "Journal", format: "YYYY-MM-DD" }) }));

			expect(target.day).toMatchObject({ folder: "Mine/Days", format: "DD-MM-YYYY" });
		});
	});

	describe("AC-MIG-04.5: re-running an unchanged import changes nothing", () => {
		it("AC-MIG-04.5: a second import of the same calendar set leaves the settings alone and marks nothing for review", () => {
			const target = freshTarget();
			const set = calendarSet({
				day: entry({ format: "YYYY-MM-DD", folder: "Journal/Daily", templatePath: "Templates/Day.md" }),
				week: entry({ format: "gggg-[W]ww", folder: "Journal/Weekly", templatePath: "" }),
			});

			expect(applyPeriodicNotesImport(target, set)).toBe(true);
			const afterFirst = structuredClone(target);

			const secondRun = applyPeriodicNotesImport(target, set);

			expect(secondRun).toBe(false);
			expect(target).toEqual(afterFirst);
			const plan = planPeriodicNotesImport(set, target);
			expect(plan.additions).toEqual([]);
			expect(plan.conflicts).toEqual([]);
			expect(decidePeriodicNotesCard(reader({ ok: true, value: set }), target)).toEqual({
				kind: "in-sync",
				setId: "Default",
			});
		});
	});
});

describe("decidePeriodicNotesCard", () => {
	describe("AC-MIG-04.6: no import offer without the plugin", () => {
		it("AC-MIG-04.6: hides the card when the Periodic Notes plugin is absent or disabled", () => {
			const card = decidePeriodicNotesCard(
				reader({ ok: false, reason: "absent", problem: "The Periodic Notes plugin is not installed." }),
				freshTarget(),
			);

			expect(card).toEqual({ kind: "hidden" });
		});

		// A plugin that is there but no longer shaped as this code reads it is a
		// different case: withdrawing the import silently would look like the
		// vault had nothing to migrate.
		it("AC-MIG-04.6: names the problem instead of hiding when the plugin is there but unreadable", () => {
			const card = decidePeriodicNotesCard(
				reader({
					ok: false,
					reason: "mismatch",
					problem: "The Periodic Notes plugin exposes no calendar set manager.",
				}),
				freshTarget(),
			);

			expect(card).toEqual({
				kind: "unreadable",
				problem: "The Periodic Notes plugin exposes no calendar set manager.",
			});
		});

		it("AC-MIG-04.6: hides the card when the active calendar set enables nothing", () => {
			const card = decidePeriodicNotesCard(
				reader({ ok: true, value: calendarSet({ day: entry({ enabled: false, folder: "Journal" }) }) }),
				freshTarget(),
			);

			expect(card).toEqual({ kind: "hidden" });
		});
	});

	it("offers the import, carrying the plan the card draws", () => {
		const set = calendarSet({ day: entry({ folder: "Journal" }) });

		const card = decidePeriodicNotesCard(reader({ ok: true, value: set }), freshTarget());

		expect(card.kind).toBe("offer");
		if (card.kind !== "offer") return;
		expect(card.set).toBe(set);
		expect(card.plan.additions.map((field) => field.id)).toEqual(["day.enabled", "day.folder"]);
	});
});
