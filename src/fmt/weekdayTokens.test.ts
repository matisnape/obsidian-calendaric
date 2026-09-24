import { afterEach, describe, expect, it } from "vitest";
import type { ReleaseGranularity } from "../types";
import { formatWithWeekTokens, getWeekNumber } from "../notes/noteUtils";
import { parseFilename } from "./parseFilename";
import { computeNoteDate } from "./noteDate";
import { applyLocale, restoreLocale } from "./locale";
import { validateFormat } from "./validateFormat";

// Read off the window, never imported from the package (no-restricted-imports).
type Moment = ReturnType<typeof window.moment>;

afterEach(() => restoreLocale());

// Sun 2026-04-12: the last day of the Monday-start week 6–12 April, and the
// first day of the Sunday-start week 12–18 April. Made after applyLocale, since
// a moment keeps the week rules of the locale it was made under.
const sunday = () => window.moment("2026-04-12");

/** The written name, and whether the parser reads it back as the same note. */
function roundTrip(format: string, date: Moment, granularity: ReleaseGranularity) {
	const written = formatWithWeekTokens(format, date, granularity);
	const parsed = parseFilename(written, format, false, granularity);
	const sameNote =
		parsed !== null && computeNoteDate(parsed.date, granularity, format) === computeNoteDate(date, granularity, format);
	return { written, sameNote };
}

describe("US-FMT-01 weekday tokens in the filename format", () => {
	it("AC-FMT-01.1: under a Monday start, {{monday:fmt}} on a Sunday is six days earlier", () => {
		applyLocale("en", "monday", "en");
		const { written, sameNote } = roundTrip("gggg-[W]ww {{monday:DD.MM}}", sunday(), "week");
		expect(written).toBe("2026-W15 06.04");
		expect(sameNote).toBe(true);
	});

	it("AC-FMT-01.2: under a Sunday start, the same token is one day later", () => {
		applyLocale("en", "sunday", "en");
		const { written, sameNote } = roundTrip("gggg-[W]ww {{monday:DD.MM}}", sunday(), "week");
		expect(written).toBe("2026-W16 13.04");
		expect(sameNote).toBe(true);
	});

	it("AC-FMT-01.3: all seven names resolve within the configured week, in any case", () => {
		applyLocale("en", "monday", "en");
		const format =
			"gggg-[W]ww {{MONDAY:DD}} {{tuesday:DD}} {{Wednesday:DD}} {{tHURSDAY:DD}} {{friday:DD}} {{SATURDAY:DD}} {{Sunday:DD}}";
		const { written, sameNote } = roundTrip(format, sunday(), "week");
		expect(written).toBe("2026-W15 06 07 08 09 10 11 12");
		expect(sameNote).toBe(true);
	});

	it.each<[ReleaseGranularity, string, string]>([
		["day", "YYYY-MM-DD {{monday:DD.MM}}", "2026-04-12 {{monday:DD.MM}}"],
		["month", "YYYY-MM {{Friday:GGGG-[W]WW}}", "2026-04 {{Friday:GGGG-[W]WW}}"],
		["year", "YYYY {{sunday:D}}", "2026 {{sunday:D}}"],
	])("AC-FMT-01.4: a %s format leaves a weekday token as literal text, and reads it back", (granularity, format, name) => {
		applyLocale("en", "monday", "en");
		const { written, sameNote } = roundTrip(format, sunday(), granularity);
		expect(written).toBe(name);
		expect(sameNote).toBe(true);
	});

	it.each<ReleaseGranularity>(["day", "week"])(
		"AC-FMT-01.5: {{funday:DD.MM}} is written as typed in a %s format, and reads back",
		(granularity) => {
			applyLocale("en", "monday", "en");
			const { written, sameNote } = roundTrip("YYYY-MM-DD {{funday:DD.MM}}", sunday(), granularity);
			expect(written).toBe("2026-04-12 {{funday:DD.MM}}");
			expect(sameNote).toBe(true);
		},
	);

	it("AC-FMT-01.5: an unknown span's letters move neither the week start nor the note's week", () => {
		// Its WW is literal text, not an ISO week, so the Sunday-start week stands.
		applyLocale("en", "sunday", "en");
		const format = "gggg-[W]ww {{monday:DD.MM}} {{funday:WW}}";
		expect(formatWithWeekTokens(format, sunday(), "week")).toBe("2026-W16 13.04 {{funday:WW}}");
		const saturday = window.moment("2026-04-18");
		expect(computeNoteDate(saturday, "week", format)).toBe(computeNoteDate(sunday(), "week", format));
		// The calendar reads the week number the filename writes: W16, not W15.
		const nested = "{{monday:gggg-[W]ww}} {{funday:W}}";
		expect(formatWithWeekTokens(nested, sunday(), "week")).toBe("2026-W16 {{funday:W}}");
		expect(getWeekNumber(sunday(), nested)).toBe(16);
	});

	it("AC-FMT-01.6: {{funday:DD.MM}} adds one warning naming funday, and the \":\" error still blocks the save", () => {
		const { errors, warnings } = validateFormat("gggg-[W]ww {{funday:DD.MM}}", "week", window.moment("2026-09-24"));
		expect(warnings.filter((warning) => warning.includes("funday"))).toHaveLength(1);
		expect(errors).toEqual([expect.stringContaining('":" cannot appear in a filename')]);
	});

	it("AC-FMT-01.6: a real weekday name raises no unrecognised-token warning", () => {
		const { warnings } = validateFormat("gggg-[W]ww {{Monday:DD}}", "week", window.moment("2026-09-24"));
		expect(warnings).toEqual([]);
	});
});
