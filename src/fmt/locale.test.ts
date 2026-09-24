import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "moment/locale/pl";
import { applyLocale, applyLocaleSettings, resolveLocale, restoreLocale, weekStartDay } from "./locale";
import { computeNotePath, formatWithWeekTokens, getWeekNumber } from "../notes/noteUtils";
import { substituteTemplateTokens } from "../notes/templateTokens";
import { computeNoteDate } from "./noteDate";
import { parseFilename } from "./parseFilename";
import { resolveWeekStart } from "../ui/calendarUtils";
import { DEFAULT_SETTINGS } from "../settings/model";

const m = window.moment;
const noFolder = { getDefaultNewFileFolder: () => "" };

/** Sat 2026-04-11: week 15 when weeks open on Monday, week 14 when they open on Sunday. */
const SATURDAY = "2026-04-11";

beforeEach(() => {
	// Importing a locale file makes it the global locale; start every test from moment's own default.
	m.locale("en");
});

afterEach(() => {
	restoreLocale();
});

describe("resolveLocale", () => {
	const known = ["en", "pl", "zh-tw"];

	it("AC-FMT-03.4: falls back to Obsidian's display language when no override is set", () => {
		expect(resolveLocale("", "pl", known)).toBe("pl");
		// Obsidian names Traditional Chinese "zh-TW"; moment names it "zh-tw".
		expect(resolveLocale("", "zh-TW", known)).toBe("zh-tw");
	});

	it("AC-FMT-03.4: an override moment knows wins over Obsidian's language", () => {
		expect(resolveLocale("en", "pl", known)).toBe("en");
	});

	it("AC-FMT-03.5: an override moment does not know falls back instead of being used", () => {
		expect(resolveLocale("xx-bogus", "pl", known)).toBe("pl");
		expect(resolveLocale("xx-bogus", "yy-bogus", known)).toBe("en");
	});
});

describe("applyLocale", () => {
	it("AC-FMT-03.4: with no override, moment follows Obsidian's language", () => {
		applyLocale("", "locale", "pl");
		expect(m.locale()).toBe("pl");
	});

	it("AC-FMT-03.5: an unknown stored locale neither throws nor blanks a weekday name", () => {
		expect(() => applyLocale("xx-bogus", "locale", "yy-bogus")).not.toThrow();
		expect(m.locale()).toBe("en");
		expect(m(SATURDAY).format("dddd")).toBe("Saturday");
	});

	it("AC-FMT-03.1: a Polish locale writes Polish names into filenames and template tokens", () => {
		applyLocale("pl", "monday", "en");
		const date = m(SATURDAY);
		const config = { ...DEFAULT_SETTINGS.day, format: "dddd D MMMM", folder: "" };

		expect(formatWithWeekTokens("dddd D MMMM", date)).toBe("sobota 11 kwietnia");
		expect(computeNotePath(date, config, noFolder)).toBe("sobota 11 kwietnia.md");
		expect(substituteTemplateTokens("{{date:dddd MMMM}}", date, "day", config, "t")).toBe("sobota kwiecień");
	});

	it("AC-FMT-03.2: the week-start setting moves every locale-week computation together", () => {
		const weekConfig = { ...DEFAULT_SETTINGS.week, format: "gggg-[W]ww", folder: "" };

		applyLocale("pl", "monday", "en");
		expect(resolveWeekStart("monday")).toBe(m.localeData().firstDayOfWeek());
		expect(formatWithWeekTokens("gggg-[W]ww", m(SATURDAY))).toBe("2026-W15");
		expect(getWeekNumber(m(SATURDAY), "gggg-[W]ww")).toBe(15);

		applyLocale("pl", "sunday", "en");
		const saturday = m(SATURDAY);
		// The grid's first column, moment's own week start, and every consumer below agree.
		expect(resolveWeekStart("sunday")).toBe(0);
		expect(m.localeData().firstDayOfWeek()).toBe(0);
		expect(formatWithWeekTokens("gggg-[W]ww", saturday)).toBe("2026-W14");
		expect(getWeekNumber(saturday, "gggg-[W]ww")).toBe(14);
		expect(computeNoteDate(saturday, "week", "gggg-[W]ww")).toBe(`week:${m("2026-04-05").valueOf()}`);
		expect(parseFilename("2026-W14", "gggg-[W]ww", false)?.date.format("YYYY-MM-DD")).toBe("2026-04-06");
		expect(computeNotePath(saturday, weekConfig, noFolder)).toBe("2026-W14.md");
		// A template weekday token reaches into the Sunday-opened week without being told the setting.
		expect(substituteTemplateTokens("{{sunday:DD}}", saturday, "week", weekConfig, "t")).toBe("05");
	});

	it("AC-FMT-03.2: ISO week tokens stay Monday-based whatever the week-start setting", () => {
		applyLocale("pl", "sunday", "en");
		expect(formatWithWeekTokens("GGGG-[W]WW", m(SATURDAY))).toBe("2026-W15");
		expect(getWeekNumber(m(SATURDAY), "GGGG-[W]WW")).toBe(15);
	});

	it("AC-FMT-03.2: 'locale default' returns to the locale's own week start after a named day", () => {
		applyLocale("pl", "sunday", "en");
		applyLocale("pl", "locale", "en");
		expect(m.localeData().firstDayOfWeek()).toBe(1);
		expect(resolveWeekStart("locale")).toBe(1);
		// Poland counts week 1 as the week holding 4 January, as ISO does.
		expect(m("2026-01-01").format("gggg-ww")).toBe("2026-01");
	});

	it("AC-FMT-03.2: a named week start keeps the locale's rule for which January week is week 1", () => {
		// en: week 1 holds 1 January. Moving the start to Monday must not move that rule.
		applyLocale("en", "monday", "en");
		expect(m("2027-01-01").format("gggg-ww")).toBe("2027-01");
		expect(m("2026-12-27").format("gggg-ww")).toBe("2026-52");
	});

	it("AC-FMT-03.3: a date made before the change is written with the new locale", () => {
		applyLocale("en", "locale", "en");
		const earlier = m(SATURDAY);
		applyLocale("pl", "sunday", "en");
		expect(formatWithWeekTokens("dddd gggg-[W]ww", earlier)).toBe("sobota 2026-W14");
	});

	it("restoreLocale puts back the locale and week rules the plugin found", () => {
		applyLocale("pl", "sunday", "en");
		restoreLocale();
		expect(m.locale()).toBe("en");
		expect(m.localeData("pl").firstDayOfWeek()).toBe(1);
		expect(m.localeData("pl").firstDayOfYear()).toBe(4);
	});
});

describe("{{weekday:fmt}} filename tokens", () => {
	/** Sun 2026-03-01 .. Sat 2026-03-07: one calendar row under a Sunday start. Made after applyLocale, as the grid makes its days. */
	const sundayRow = (): ReturnType<typeof m>[] => Array.from({ length: 7 }, (_, i) => m("2026-03-01").add(i, "day"));
	const weekConfig = (format: string) => ({ ...DEFAULT_SETTINGS.week, format, folder: "" });

	it("AC-FMT-03.2: every day of a Sunday-start row resolves to one weekly file", () => {
		applyLocale("en", "sunday", "en");
		const format = "{{monday:GGGG-[W]WW}}";
		const row = sundayRow();
		const paths = row.map((day) => computeNotePath(day, weekConfig(format), noFolder));
		expect(new Set(paths)).toEqual(new Set(["2026-W10.md"]));
		expect(new Set(row.map((day) => getWeekNumber(day, format)))).toEqual(new Set([10]));
		expect(new Set(row.map((day) => computeNoteDate(day, "week", format))).size).toBe(1);
	});

	it("AC-FMT-03.2: a weekday-token filename written under a non-Monday start reads back as its own week", () => {
		for (const weekStart of ["sunday", "tuesday"] as const) {
			applyLocale("en", weekStart, "en");
			for (const format of ["{{monday:GGGG-[W]WW}}", "{{sunday:YYYY-MM-DD}}"]) {
				for (const day of sundayRow()) {
					const written = formatWithWeekTokens(format, day);
					const parsed = parseFilename(written, format, false);
					expect(parsed, `${weekStart} ${format} ${written}`).not.toBeNull();
					expect(computeNoteDate(parsed!.date, "week", format), `${weekStart} ${format} ${written}`)
						.toBe(computeNoteDate(day, "week", format));
				}
			}
		}
	});

	it("AC-FMT-03.2: a format numbering ISO weeks resolves its weekday tokens in that ISO week, whatever the week start", () => {
		applyLocale("en", "sunday", "en");
		// Mon 2026-02-23 .. Sun 2026-03-01: one ISO week, so one period and one file.
		const isoWeek = Array.from({ length: 7 }, (_, i) => m("2026-02-23").add(i, "day"));
		// The second format carries no top-level year, so only its span can give the parser a date.
		const cases = [
			["GGGG-[W]WW ({{monday:DD.MM}}-{{sunday:DD.MM}})", "2026-W09 (23.02-01.03)"],
			["[W]WW, {{sunday:YYYY-MM-DD}}", "W09, 2026-03-01"],
		] as const;
		for (const [format, name] of cases) {
			expect(new Set(isoWeek.map((day) => formatWithWeekTokens(format, day)))).toEqual(new Set([name]));
			const parsed = parseFilename(name, format, false);
			expect(parsed, format).not.toBeNull();
			for (const day of isoWeek) {
				expect(computeNoteDate(parsed!.date, "week", format)).toBe(computeNoteDate(day, "week", format));
			}
		}
	});

	it("AC-FMT-03.2: a Monday start writes the same weekday-token filenames as the ISO week did", () => {
		applyLocale("en", "monday", "en");
		const format = "{{monday:GGGG-[W]WW}} {{sunday:DD.MM}}";
		for (let i = 0; i < 14; i++) {
			const day = m("2026-03-01").add(i, "day");
			const iso = `${day.clone().isoWeekday(1).format("GGGG-[W]WW")} ${day.clone().isoWeekday(7).format("DD.MM")}`;
			expect(formatWithWeekTokens(format, day)).toBe(iso);
		}
	});
});

describe("applyLocaleSettings", () => {
	it("AC-FMT-03.3: a saved setting reaches moment before the re-render runs", () => {
		let seen = "";
		applyLocaleSettings({ overrideLocale: "pl", weekStart: "sunday" }, "en", () => {
			seen = `${m.locale()} ${m.localeData().firstDayOfWeek()}`;
		});
		expect(seen).toBe("pl 0");
	});
});

describe("weekStartDay", () => {
	it("AC-FMT-03.2: maps each named day to moment's day() number, and 'locale' to the locale's own", () => {
		expect(weekStartDay("sunday", 1)).toBe(0);
		expect(weekStartDay("saturday", 1)).toBe(6);
		expect(weekStartDay("locale", 3)).toBe(3);
	});
});
