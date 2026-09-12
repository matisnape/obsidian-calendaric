import { describe, it, expect } from "vitest";
import type {
	CompanionPluginRead,
	DailyNotesPluginState,
	PeriodicNotesPort,
} from "../adapters/companionPluginPort";
import type { Granularity } from "../types";
import { GRANULARITIES } from "./model";
import { resolveImportSources } from "./importSource";

function periodic(read: CompanionPluginRead<readonly string[]>): PeriodicNotesPort {
	return { readActiveGranularities: () => read };
}

/** Periodic Notes installed, with exactly these granularities enabled. */
function enables(...granularities: string[]): PeriodicNotesPort {
	return periodic({ ok: true, value: granularities });
}

const NO_PERIODIC_NOTES = periodic({
	ok: false,
	reason: "absent",
	problem: "The Periodic Notes plugin is not installed.",
});

/** Periodic Notes installed, but this build publishes no readable active set. */
const UNREADABLE_PERIODIC_NOTES = periodic({
	ok: false,
	reason: "mismatch",
	problem: "The Periodic Notes plugin exposes no calendar set manager.",
});

function daily(read: CompanionPluginRead<DailyNotesPluginState>) {
	return { readDailyNotes: () => read };
}

const DAILY_NOTES_ON = daily({
	ok: true,
	value: { enabled: true, format: "DD-MM-YYYY", folder: "Journal", template: "t/daily" },
});

const DAILY_NOTES_OFF = daily({ ok: true, value: { enabled: false } });

const NO_DAILY_NOTES = daily({
	ok: false,
	reason: "absent",
	problem: "The core Daily Notes plugin is not installed.",
});

/** Every granularity the resolution answers for, apart from day. */
const BEYOND_DAY: readonly Granularity[] = GRANULARITIES.filter((granularity) => granularity !== "day");

describe("resolveImportSources", () => {
	describe("AC-MIG-05.1: Periodic Notes governs what its active calendar set enables", () => {
		// The whole point of the precedence: the core plugin is enabled and holds
		// its own format, and it still does not decide this granularity.
		it("AC-MIG-05.1: day resolves to Periodic Notes even while core Daily Notes is enabled", () => {
			const sources = resolveImportSources(enables("day"), DAILY_NOTES_ON);

			expect(sources.day.source).toBe("periodic-notes");
		});

		it("AC-MIG-05.1: every granularity the active calendar set enables resolves to Periodic Notes", () => {
			const sources = resolveImportSources(enables(...GRANULARITIES), DAILY_NOTES_ON);

			for (const granularity of GRANULARITIES) {
				expect(sources[granularity].source).toBe("periodic-notes");
			}
		});

		// The other half of the same rule: authority is per granularity, so one
		// enabled granularity must not carry the granularities beside it.
		it("AC-MIG-05.1: a granularity the active calendar set leaves off does not resolve to Periodic Notes", () => {
			const sources = resolveImportSources(enables("day"), NO_DAILY_NOTES);

			for (const granularity of BEYOND_DAY) {
				expect(sources[granularity].source).not.toBe("periodic-notes");
			}
		});

		// A name this version does not know is another plugin's business, not a
		// reason to refuse the granularities it does know.
		it("AC-MIG-05.1: a granularity name Calendaric does not know changes nothing", () => {
			const sources = resolveImportSources(enables("fiscal-year", "week"), NO_DAILY_NOTES);

			expect(sources.week.source).toBe("periodic-notes");
			expect(sources.day.source).toBe("none");
		});
	});

	describe("AC-MIG-05.2: core Daily Notes governs day when Periodic Notes does not", () => {
		it("AC-MIG-05.2: day resolves to core Daily Notes when the Periodic Notes active set leaves day off", () => {
			const sources = resolveImportSources(enables("week", "month"), DAILY_NOTES_ON);

			expect(sources.day.source).toBe("daily-notes");
		});

		it("AC-MIG-05.2: day resolves to core Daily Notes when Periodic Notes is absent", () => {
			const sources = resolveImportSources(NO_PERIODIC_NOTES, DAILY_NOTES_ON);

			expect(sources.day.source).toBe("daily-notes");
		});

		it("AC-MIG-05.2: day reports no source when the core Daily Notes plugin is disabled", () => {
			const sources = resolveImportSources(NO_PERIODIC_NOTES, DAILY_NOTES_OFF);

			expect(sources.day.source).toBe("none");
		});

		// The fallback is day's alone: the core plugin configures nothing else, so
		// borrowing its folder and format for week would import settings the vault
		// never had.
		it("AC-MIG-05.2: no granularity beyond day falls back to core Daily Notes", () => {
			const sources = resolveImportSources(NO_PERIODIC_NOTES, DAILY_NOTES_ON);

			for (const granularity of BEYOND_DAY) {
				expect(sources[granularity].source).toBe("none");
			}
		});
	});

	describe("AC-MIG-05.3: nothing enabled means nothing to import", () => {
		it("AC-MIG-05.3: reports every granularity as having no external configuration", () => {
			const sources = resolveImportSources(NO_PERIODIC_NOTES, NO_DAILY_NOTES);

			for (const granularity of GRANULARITIES) {
				const resolved = sources[granularity];
				expect(resolved.source).toBe("none");
				if (resolved.source !== "none") return;
				expect(resolved.reason).not.toBe("");
			}
		});

		it("AC-MIG-05.3: does not throw when neither predecessor plugin can be read", () => {
			expect(() => resolveImportSources(NO_PERIODIC_NOTES, NO_DAILY_NOTES)).not.toThrow();
		});

		it("AC-MIG-05.3: does not throw when a predecessor plugin is installed but broken", () => {
			expect(() =>
				resolveImportSources(
					UNREADABLE_PERIODIC_NOTES,
					daily({ ok: false, reason: "mismatch", problem: "The core Daily Notes plugin is not an object." }),
				),
			).not.toThrow();
		});
	});

	describe("AC-MIG-05.4: an unreadable Periodic Notes build governs nothing", () => {
		// Guessing from `settings` is what this refuses: that object is a store on
		// every build that has one, so it reports nothing enabled whatever the
		// user configured (docs/mapping/sources/cal.json,
		// capability `periodic-notes-weekly-detection`).
		it("AC-MIG-05.4: every granularity reads as not externally configured", () => {
			const sources = resolveImportSources(UNREADABLE_PERIODIC_NOTES, NO_DAILY_NOTES);

			for (const granularity of GRANULARITIES) {
				expect(sources[granularity].source).toBe("none");
			}
		});

		it("AC-MIG-05.4: the reason names the plugin that could not be read", () => {
			const sources = resolveImportSources(UNREADABLE_PERIODIC_NOTES, NO_DAILY_NOTES);
			const resolved = sources.week;

			expect(resolved.source).toBe("none");
			if (resolved.source !== "none") return;
			expect(resolved.reason).toMatch(/calendar set manager/i);
		});

		// Unreadable is not the same as denying: day still has its own fallback,
		// and withholding it would drop a configuration the vault really has.
		it("AC-MIG-05.4: day still falls back to core Daily Notes", () => {
			const sources = resolveImportSources(UNREADABLE_PERIODIC_NOTES, DAILY_NOTES_ON);

			expect(sources.day.source).toBe("daily-notes");
		});
	});

	describe("AC-MIG-05.5: one routine answers for every granularity", () => {
		it("AC-MIG-05.5: answers for every granularity Calendaric knows, from the one list", () => {
			const sources = resolveImportSources(NO_PERIODIC_NOTES, NO_DAILY_NOTES);

			expect(Object.keys(sources).sort()).toEqual([...GRANULARITIES].sort());
		});

		// One routine, so one read per plugin: a per-granularity implementation
		// would ask the host the same question five times over.
		it("AC-MIG-05.5: reads each predecessor plugin once for the whole resolution", () => {
			let periodicReads = 0;
			let dailyReads = 0;
			const countingPeriodic: PeriodicNotesPort = {
				readActiveGranularities: () => {
					periodicReads += 1;
					return { ok: true, value: ["day"] };
				},
			};
			const countingDaily = {
				readDailyNotes: (): CompanionPluginRead<DailyNotesPluginState> => {
					dailyReads += 1;
					return { ok: true, value: { enabled: false } };
				},
			};

			resolveImportSources(countingPeriodic, countingDaily);

			expect(periodicReads).toBe(1);
			expect(dailyReads).toBe(1);
		});
	});
});
