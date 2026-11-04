import { describe, it, expect } from "vitest";
import type {
	CalendarPluginSettings,
	CompanionPluginRead,
	DailyNotesPluginState,
} from "../adapters/companionPluginPort";
import { DEFAULT_SETTINGS } from "./model";
import type { CalendaricSettings } from "./model";
import { applyCalendarImport, decideCalendarImportCard } from "./calendarImport";
import type { CalendarImportFieldId, CalendarImportPorts } from "./calendarImport";

const LOCALES = ["en", "en-gb", "pl"];

function ports(
	calendar: CompanionPluginRead<CalendarPluginSettings>,
	periodicWeeks: readonly string[] = [],
): CalendarImportPorts {
	const dailyNotes: CompanionPluginRead<DailyNotesPluginState> = { ok: true, value: { enabled: false } };
	return {
		calendar: { readCalendarSettings: () => calendar },
		periodicNotes: { readActiveGranularities: () => ({ ok: true, value: periodicWeeks }) },
		companion: { readDailyNotes: () => dailyNotes },
	};
}

const enabled = (settings: CalendarPluginSettings): CompanionPluginRead<CalendarPluginSettings> => ({
	ok: true,
	value: settings,
});

function fresh(): CalendaricSettings {
	return structuredClone(DEFAULT_SETTINGS);
}

/** Week starts enabled by default, so the criterion that enables it starts from off. */
function weekOff(): CalendaricSettings {
	const target = fresh();
	target.week.enabled = false;
	return target;
}

function importInto(
	target: CalendaricSettings,
	source: CalendarImportPorts,
	confirmed: readonly CalendarImportFieldId[] = [],
): CalendaricSettings {
	const card = decideCalendarImportCard(source, target, LOCALES);
	if (card.kind !== "offer") throw new Error(`expected an offer, got ${card.kind}`);
	applyCalendarImport(target, card.plan, confirmed);
	return target;
}

describe("decideCalendarImportCard / applyCalendarImport", () => {
	it("AC-MIG-03.1: sets week folder, format and template from the Calendar plugin and enables week", () => {
		const target = importInto(
			weekOff(),
			ports(
				enabled({
					weeklyNoteFormat: "gggg-[W]ww",
					weeklyNoteFolder: " Journal/Weekly ",
					weeklyNoteTemplate: "Templates/Week.md",
				}),
			),
		);

		expect(target.week).toMatchObject({
			enabled: true,
			format: "gggg-[W]ww",
			folder: "Journal/Weekly",
			templatePath: "Templates/Week.md",
		});
	});

	it("AC-MIG-03.1: the week format is imported as the Calendar plugin uses it, untrimmed", () => {
		const target = importInto(weekOff(), ports(enabled({ weeklyNoteFormat: " gggg-ww" })));

		expect(target.week.format).toBe(" gggg-ww");
	});

	it("AC-MIG-03.1: one week field alone is enough to enable week", () => {
		const target = importInto(weekOff(), ports(enabled({ weeklyNoteFolder: "Weekly" })));

		expect(target.week.enabled).toBe(true);
		expect(target.week.folder).toBe("Weekly");
		expect(target.week.format).toBe("");
	});

	it("AC-MIG-03.2: with Periodic Notes governing week, the Calendar plugin's settings-screen week fields are not imported, but its display preferences are", () => {
		const target = weekOff();
		const before = structuredClone(target.week);

		importInto(
			target,
			ports(
				enabled({
					weeklyNoteFormat: "[unused]-ww",
					weeklyNoteFolder: "Unused",
					weeklyNoteTemplate: "Unused.md",
					weekStart: "sunday",
				}),
				["week"],
			),
		);

		// US-MIG-04 imports week from Periodic Notes; the Calendar import leaves it whole.
		expect(target.week).toEqual(before);
		expect(target.weekStart).toBe("sunday");
	});

	it("AC-MIG-03.2: Periodic Notes governing only other granularities does not hold back the Calendar week fields", () => {
		const target = importInto(fresh(), ports(enabled({ weeklyNoteFormat: "gggg-ww" }), ["day", "month"]));

		expect(target.week.format).toBe("gggg-ww");
	});

	it("AC-MIG-03.3: week start, confirm-before-create, week numbers and locale override take the Calendar plugin's values", () => {
		const target = importInto(
			fresh(),
			ports(
				enabled({
					weekStart: "sunday",
					shouldConfirmBeforeCreate: false,
					showWeeklyNote: false,
					localeOverride: "pl",
				}),
			),
		);

		expect(target.weekStart).toBe("sunday");
		expect(target.confirmBeforeCreate).toBe(false);
		expect(target.showWeekNumbers).toBe(false);
		expect(target.overrideLocale).toBe("pl");
	});

	it("AC-MIG-03.3: the Calendar plugin's 'system-default' locale is Calendaric's empty override", () => {
		const target = fresh();
		target.overrideLocale = "pl";

		importInto(target, ports(enabled({ localeOverride: "system-default" })));

		expect(target.overrideLocale).toBe("");
	});

	it("AC-MIG-03.3: a value with no Calendaric equivalent is reported, not guessed", () => {
		const target = fresh();
		const card = decideCalendarImportCard(
			ports(enabled({ weekStart: "someday", localeOverride: "xx-unknown", wordsPerDot: 0 })),
			target,
			LOCALES,
		);

		expect(card.kind).toBe("offer");
		if (card.kind !== "offer") return;
		expect(card.plan.changes).toEqual([]);
		expect(card.plan.unmapped.map((entry) => entry.label)).toEqual([
			"Week start",
			"Words per dot",
			"Locale override",
		]);
		applyCalendarImport(target, card.plan, []);
		expect(target).toEqual(fresh());
	});

	it("AC-MIG-03.4: a stored wordsPerDot of 250 becomes Calendaric's global words per dot", () => {
		const target = fresh();
		target.wordsPerDot = 400;

		importInto(target, ports(enabled({ wordsPerDot: 250 })));

		expect(target.wordsPerDot).toBe(250);
	});

	describe("AC-MIG-03.5: a customised week value is only replaced after the user confirms", () => {
		function customised(): CalendaricSettings {
			const target = fresh();
			target.week = { ...target.week, enabled: true, format: "GGGG-[W]WW", folder: "Mine", templatePath: "Mine.md" };
			return target;
		}
		const incoming = ports(
			enabled({ weeklyNoteFormat: "gggg-ww", weeklyNoteFolder: "Theirs", weeklyNoteTemplate: "Theirs.md" }),
		);

		it("AC-MIG-03.5: lists each customised value with the incoming one beside it", () => {
			const card = decideCalendarImportCard(incoming, customised(), LOCALES);

			expect(card.kind).toBe("offer");
			if (card.kind !== "offer") return;
			expect(card.plan.conflicts.map(({ id, current, incoming }) => ({ id, current, incoming }))).toEqual([
				{ id: "week.format", current: "GGGG-[W]WW", incoming: "gggg-ww" },
				{ id: "week.folder", current: "Mine", incoming: "Theirs" },
				{ id: "week.templatePath", current: "Mine.md", incoming: "Theirs.md" },
			]);
		});

		it("AC-MIG-03.5: declining leaves every customised value byte-identical", () => {
			const target = customised();
			const before = structuredClone(target);

			importInto(target, incoming, []);

			expect(target).toEqual(before);
		});

		it("AC-MIG-03.5: confirming one value replaces that one only", () => {
			const target = importInto(customised(), incoming, ["week.folder"]);

			expect(target.week).toMatchObject({ format: "GGGG-[W]WW", folder: "Theirs", templatePath: "Mine.md" });
		});
	});

	it("AC-MIG-03.6: no offer when the Calendar plugin is not installed or not enabled", () => {
		const card = decideCalendarImportCard(
			ports({ ok: false, reason: "absent", problem: "The Calendar plugin is not installed." }),
			fresh(),
			LOCALES,
		);

		expect(card).toEqual({ kind: "hidden" });
	});

	it("AC-MIG-03.6: a Calendar plugin that cannot be read says so instead of offering an import", () => {
		const card = decideCalendarImportCard(
			ports({ ok: false, reason: "mismatch", problem: "weekStart is not a string." }),
			fresh(),
			LOCALES,
		);

		expect(card).toEqual({ kind: "unreadable", problem: "weekStart is not a string." });
	});

	it("AC-MIG-03.7: offered when the display fields carry values, even ones Calendaric already has", () => {
		const card = decideCalendarImportCard(
			ports(
				enabled({
					shouldConfirmBeforeCreate: true,
					weekStart: "monday",
					wordsPerDot: 250,
					showWeeklyNote: true,
					localeOverride: "system-default",
					weeklyNoteFormat: "",
					weeklyNoteTemplate: "",
					weeklyNoteFolder: "",
				}),
			),
			fresh(),
			LOCALES,
		);

		expect(card.kind).toBe("offer");
	});

	it("AC-MIG-03.8: not offered when every field the importer reads is unset", () => {
		const card = decideCalendarImportCard(ports(enabled({})), fresh(), LOCALES);

		expect(card).toEqual({ kind: "hidden" });
	});

	it("AC-MIG-03.8: empty and blank week fields count as unset, not as the interface's default format", () => {
		const card = decideCalendarImportCard(
			ports(enabled({ weeklyNoteFormat: "", weeklyNoteFolder: "  ", weeklyNoteTemplate: "" })),
			fresh(),
			LOCALES,
		);

		expect(card).toEqual({ kind: "hidden" });
	});
});
