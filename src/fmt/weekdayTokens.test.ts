import { afterEach, describe, expect, it } from "vitest";
import type { ReleaseGranularity } from "../types";
import { formatWithWeekTokens } from "../notes/noteUtils";
import { parseFilename } from "./parseFilename";
import { computeNoteDate } from "./noteDate";
import { applyLocale, restoreLocale } from "./locale";

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
});
