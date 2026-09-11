import { describe, it, expect } from "vitest";
import {
	applySettings,
	DEFAULT_CALENDAR_SET_ID,
	GRANULARITIES,
	getActiveGranularities,
	getActiveSet,
	getInactiveGranularities,
	loadStoredConfig,
	toSettings,
} from "./model";
import type { CalendarSet, StoredConfig } from "./model";
import { DEFAULT_PERIODIC_CONFIG } from "../types";

/** A fully written-out stored configuration, as `saveData` would have left it. */
function storedFixture(extra: Partial<StoredConfig> = {}): Record<string, unknown> {
	return {
		weekStart: "monday",
		showWeekNumbers: true,
		confirmBeforeCreate: true,
		overrideLocale: "",
		hasMigratedDailyNoteSettings: false,
		activeCalendarSet: "Default",
		calendarSets: [
			{
				id: "Default",
				day: {
					enabled: true,
					format: "YYYY-MM-DD",
					folder: "journal/day",
					templatePath: "templates/day",
					allowPrefixMatching: false,
					openAtStartup: false,
				},
				week: {
					enabled: true,
					format: "gggg-[W]ww",
					folder: "journal/week",
					templatePath: "templates/week",
					allowPrefixMatching: true,
					openAtStartup: false,
				},
				month: {
					enabled: false,
					format: "YYYY-MM",
					folder: "journal/month",
					templatePath: "templates/month",
					allowPrefixMatching: false,
					openAtStartup: false,
				},
				quarter: {
					enabled: false,
					format: "YYYY-[Q]Q",
					folder: "journal/quarter",
					templatePath: "",
					allowPrefixMatching: false,
					openAtStartup: false,
				},
				year: {
					enabled: false,
					format: "YYYY",
					folder: "journal/year",
					templatePath: "templates/year",
					allowPrefixMatching: true,
					openAtStartup: false,
				},
			},
		],
		...extra,
	};
}

/** A second named group, the one no UI can reach yet. */
const EXTRA_SET = {
	id: "Work",
	day: {
		enabled: true,
		format: "DD.MM.YYYY",
		folder: "work/days",
		templatePath: "work/templates/day",
		allowPrefixMatching: true,
		openAtStartup: true,
	},
	week: {
		enabled: false,
		format: "[W]ww-gggg",
		folder: "work/weeks",
		templatePath: "",
		allowPrefixMatching: false,
		openAtStartup: false,
	},
};

describe("AC-SET-01.1 every granularity owns its own five values", () => {
	it("gives every granularity an enabled flag, format, folder, template path and allow-prefix-matching value", () => {
		const settings = toSettings(loadStoredConfig(storedFixture()));

		for (const granularity of GRANULARITIES) {
			const config = settings[granularity];
			expect(typeof config.enabled, granularity).toBe("boolean");
			expect(typeof config.format, granularity).toBe("string");
			expect(typeof config.folder, granularity).toBe("string");
			expect(typeof config.templatePath, granularity).toBe("string");
			expect(typeof config.allowPrefixMatching, granularity).toBe("boolean");
		}
	});

	it("reads each granularity's five values from that granularity's own stored entry", () => {
		const settings = toSettings(loadStoredConfig(storedFixture()));

		expect(settings.day.folder).toBe("journal/day");
		expect(settings.week.folder).toBe("journal/week");
		expect(settings.month.format).toBe("YYYY-MM");
		expect(settings.year.templatePath).toBe("templates/year");
		expect(settings.week.allowPrefixMatching).toBe(true);
		expect(settings.day.allowPrefixMatching).toBe(false);
	});

	it("never shares one config object between two granularities", () => {
		const settings = toSettings(loadStoredConfig(storedFixture()));

		const seen = GRANULARITIES.map((granularity) => settings[granularity]);
		expect(new Set(seen).size).toBe(GRANULARITIES.length);
	});

	it("does not alias the built-in defaults, so editing a loaded value cannot change them", () => {
		const settings = toSettings(loadStoredConfig(undefined));
		settings.month.folder = "edited";
		settings.month.allowPrefixMatching = true;

		expect(DEFAULT_PERIODIC_CONFIG.folder).toBe("");
		expect(DEFAULT_PERIODIC_CONFIG.allowPrefixMatching).toBe(false);
		expect(toSettings(loadStoredConfig(undefined)).month.folder).toBe("");
	});

	it("does not alias the defaults for a granularity the stored group never mentioned", () => {
		const stored = loadStoredConfig({ calendarSets: [{ id: "Default", day: { enabled: true } }] });
		const settings = toSettings(stored);

		settings.year.folder = "edited";
		settings.year.allowPrefixMatching = true;

		expect(DEFAULT_PERIODIC_CONFIG.folder).toBe("");
		expect(DEFAULT_PERIODIC_CONFIG.allowPrefixMatching).toBe(false);
		expect(toSettings(stored).year.folder).toBe("");
		expect(settings.quarter.folder).toBe("");
	});

	it("gives the loaded group its own config objects rather than the shared defaults", () => {
		const stored = loadStoredConfig({ calendarSets: [{ id: "Default", day: { enabled: true } }] });
		const active = getActiveSet(stored);

		for (const granularity of GRANULARITIES) {
			expect(active[granularity], granularity).not.toBe(DEFAULT_PERIODIC_CONFIG);
		}
		expect(new Set(GRANULARITIES.map((granularity) => active[granularity])).size).toBe(GRANULARITIES.length);
	});

	it("fills the missing granularities of the group in use with defaults", () => {
		const stored = loadStoredConfig({
			activeCalendarSet: "Default",
			calendarSets: [{ id: "Default", day: { enabled: true, format: "YYYY-MM-DD" } }],
		});
		const settings = toSettings(stored);

		expect(settings.day.format).toBe("YYYY-MM-DD");
		expect(settings.day.folder).toBe("");
		expect(settings.day.allowPrefixMatching).toBe(false);
		expect(settings.year.enabled).toBe(false);
		expect(settings.year.format).toBe("");
	});
});

describe("AC-SET-01.2 an allow-prefix-matching change touches one granularity only", () => {
	it("stores the new value for the changed granularity", () => {
		const stored = loadStoredConfig(storedFixture());
		const settings = toSettings(stored);

		settings.day.allowPrefixMatching = true;
		const saved = applySettings(stored, settings);

		expect(getActiveSet(saved).day?.allowPrefixMatching).toBe(true);
	});

	it("leaves every other granularity's stored settings unchanged", () => {
		const stored = loadStoredConfig(storedFixture());
		const before = getActiveSet(stored);
		const untouched = { week: before.week, month: before.month, quarter: before.quarter, year: before.year };

		const settings = toSettings(stored);
		settings.day.allowPrefixMatching = true;
		const after = getActiveSet(applySettings(stored, settings));

		expect(after.week).toEqual(untouched.week);
		expect(after.month).toEqual(untouched.month);
		expect(after.quarter).toEqual(untouched.quarter);
		expect(after.year).toEqual(untouched.year);
	});

	it("leaves the other granularities alone for every granularity that can be toggled", () => {
		for (const changed of GRANULARITIES) {
			const stored = loadStoredConfig(storedFixture());
			const before = getActiveSet(stored);
			const settings = toSettings(stored);

			settings[changed].allowPrefixMatching = !settings[changed].allowPrefixMatching;
			const after = getActiveSet(applySettings(stored, settings));

			for (const other of GRANULARITIES) {
				if (other === changed) continue;
				expect(after[other], `${changed} changed, ${other} must not`).toEqual(before[other]);
			}
		}
	});
});

describe("AC-SET-01.3 an extra named group survives a load and save", () => {
	it("preserves the extra group exactly", () => {
		const raw = storedFixture({ calendarSets: [...(storedFixture().calendarSets as CalendarSet[]), EXTRA_SET as CalendarSet] });
		const stored = loadStoredConfig(raw);

		const saved = applySettings(stored, toSettings(stored));

		expect(saved.calendarSets).toHaveLength(2);
		expect(saved.calendarSets[1]).toEqual(EXTRA_SET);
	});

	it("preserves the in-use group exactly", () => {
		const raw = storedFixture({ calendarSets: [...(storedFixture().calendarSets as CalendarSet[]), EXTRA_SET as CalendarSet] });
		const inUse = (raw.calendarSets as CalendarSet[])[0];
		const stored = loadStoredConfig(raw);

		const saved = applySettings(stored, toSettings(stored));

		expect(saved.calendarSets[0]).toEqual(inUse);
	});

	it("keeps keys it does not recognise inside the extra group", () => {
		const alien = { id: "Work", custom: { enabled: true, format: "[W]ww" }, someFutureField: 42 };
		const raw = storedFixture({ calendarSets: [...(storedFixture().calendarSets as CalendarSet[]), alien as unknown as CalendarSet] });

		const stored = loadStoredConfig(raw);
		const saved = applySettings(stored, toSettings(stored));

		expect(saved.calendarSets[1]).toEqual(alien);
	});

	it("rewrites one group only when two groups carry the same id", () => {
		const twin = { ...EXTRA_SET, id: "Default" };
		const raw = storedFixture({ calendarSets: [...(storedFixture().calendarSets as CalendarSet[]), twin as CalendarSet] });
		const stored = loadStoredConfig(raw);

		const settings = toSettings(stored);
		settings.day.folder = "somewhere/else";
		const saved = applySettings(stored, settings);

		expect(saved.calendarSets[0]?.day?.folder).toBe("somewhere/else");
		expect(saved.calendarSets[1]).toEqual(twin);
	});

	it("keeps the extra group when the in-use group is edited", () => {
		const raw = storedFixture({ calendarSets: [...(storedFixture().calendarSets as CalendarSet[]), EXTRA_SET as CalendarSet] });
		const stored = loadStoredConfig(raw);

		const settings = toSettings(stored);
		settings.day.folder = "somewhere/else";
		const saved = applySettings(stored, settings);

		expect(saved.calendarSets[1]).toEqual(EXTRA_SET);
		expect(getActiveSet(saved).day?.folder).toBe("somewhere/else");
	});
});

describe("AC-SET-01.4 disabling a granularity keeps its configured values", () => {
	it("keeps format, folder, template path and allow-prefix-matching when the toggle goes off", () => {
		const stored = loadStoredConfig(storedFixture());
		const settings = toSettings(stored);

		settings.week.enabled = false;
		const saved = applySettings(stored, settings);
		const week = getActiveSet(saved).week;

		expect(week?.enabled).toBe(false);
		expect(week?.format).toBe("gggg-[W]ww");
		expect(week?.folder).toBe("journal/week");
		expect(week?.templatePath).toBe("templates/week");
		expect(week?.allowPrefixMatching).toBe(true);
	});

	it("shows the same values again when the granularity is re-enabled after a restart", () => {
		const stored = loadStoredConfig(storedFixture());
		const disabled = toSettings(stored);
		disabled.week.enabled = false;

		const reloaded = toSettings(loadStoredConfig(applySettings(stored, disabled)));
		reloaded.week.enabled = true;
		const reenabled = toSettings(loadStoredConfig(applySettings(stored, reloaded)));

		expect(reenabled.week.format).toBe("gggg-[W]ww");
		expect(reenabled.week.folder).toBe("journal/week");
		expect(reenabled.week.templatePath).toBe("templates/week");
		expect(reenabled.week.allowPrefixMatching).toBe(true);
	});

	it("keeps a disabled granularity's values through a load and save round trip", () => {
		const stored = loadStoredConfig(storedFixture());

		const saved = applySettings(stored, toSettings(stored));
		const month = getActiveSet(loadStoredConfig(saved)).month;

		expect(month?.enabled).toBe(false);
		expect(month?.format).toBe("YYYY-MM");
		expect(month?.folder).toBe("journal/month");
		expect(month?.templatePath).toBe("templates/month");
	});
});

describe("AC-SET-01.5 a fresh install has exactly one implicit group", () => {
	it("creates one group when nothing was ever saved", () => {
		const stored = loadStoredConfig(undefined);

		expect(stored.calendarSets).toHaveLength(1);
		expect(stored.activeCalendarSet).toBe(DEFAULT_CALENDAR_SET_ID);
		expect(stored.calendarSets[0]?.id).toBe(DEFAULT_CALENDAR_SET_ID);
	});

	it("creates one group when the stored data holds no group at all", () => {
		const stored = loadStoredConfig({ weekStart: "sunday" });

		expect(stored.calendarSets).toHaveLength(1);
		expect(stored.activeCalendarSet).toBe(DEFAULT_CALENDAR_SET_ID);
		expect(stored.weekStart).toBe("sunday");
	});

	it("creates one group when the stored group list is empty", () => {
		const stored = loadStoredConfig({ activeCalendarSet: "", calendarSets: [] });

		expect(stored.calendarSets).toHaveLength(1);
		expect(stored.activeCalendarSet).toBe(DEFAULT_CALENDAR_SET_ID);
	});

	it("names the implicit group itself, so nothing has to be asked of the user", () => {
		const first = loadStoredConfig(undefined);
		const saved = applySettings(first, toSettings(first));
		const second = loadStoredConfig(saved);

		expect(second.calendarSets).toHaveLength(1);
		expect(second.activeCalendarSet).toBe(DEFAULT_CALENDAR_SET_ID);
	});

	it("enables the day and week granularities on a fresh install", () => {
		const settings = toSettings(loadStoredConfig(undefined));

		expect(getActiveGranularities(settings)).toEqual(["day", "week"]);
	});
});

describe("getActiveSet", () => {
	it("returns the group named by activeCalendarSet", () => {
		const raw = storedFixture({
			activeCalendarSet: "Work",
			calendarSets: [...(storedFixture().calendarSets as CalendarSet[]), EXTRA_SET as CalendarSet],
		});

		expect(getActiveSet(loadStoredConfig(raw)).id).toBe("Work");
	});

	it("falls back to the first group when activeCalendarSet names a group that is gone", () => {
		const raw = storedFixture({ activeCalendarSet: "Deleted" });

		const stored = loadStoredConfig(raw);

		expect(stored.activeCalendarSet).toBe("Default");
		expect(getActiveSet(stored).id).toBe("Default");
	});

	it("edits the group named by activeCalendarSet, not the first one", () => {
		const raw = storedFixture({
			activeCalendarSet: "Work",
			calendarSets: [...(storedFixture().calendarSets as CalendarSet[]), EXTRA_SET as CalendarSet],
		});
		const stored = loadStoredConfig(raw);
		const inUseBefore = (raw.calendarSets as CalendarSet[])[0];

		const settings = toSettings(stored);
		settings.day.folder = "work/elsewhere";
		const saved = applySettings(stored, settings);

		expect(saved.calendarSets[1]?.day?.folder).toBe("work/elsewhere");
		expect(saved.calendarSets[0]).toEqual(inUseBefore);
	});
});

describe("getActiveGranularities / getInactiveGranularities", () => {
	it("lists enabled granularities in day-to-year order", () => {
		const settings = toSettings(loadStoredConfig(storedFixture()));
		settings.year.enabled = true;

		expect(getActiveGranularities(settings)).toEqual(["day", "week", "year"]);
	});

	it("lists the granularities that are off", () => {
		const settings = toSettings(loadStoredConfig(storedFixture()));

		expect(getInactiveGranularities(settings)).toEqual(["month", "quarter", "year"]);
	});

	it("treats a granularity the stored group never mentioned as off", () => {
		const set = getActiveSet(loadStoredConfig({ calendarSets: [{ id: "Default", day: { enabled: true } }] }));

		expect(getActiveGranularities(set)).toEqual(["day"]);
		expect(getInactiveGranularities(set)).toEqual(["week", "month", "quarter", "year"]);
	});
});
