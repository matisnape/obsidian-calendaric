import { describe, it, expect } from "vitest";
import { suggestPeriods } from "./datePhrase";
import type { ParseDate } from "./datePhrase";
import { RELEASE_GRANULARITIES } from "../types";

function parser(known: Record<string, string>): ParseDate {
	return (phrase) => {
		const iso = known[phrase.toLowerCase()];
		return iso === undefined ? null : new Date(`${iso}T12:00:00`);
	};
}

const ALL = RELEASE_GRANULARITIES;

describe("US-CMD-10: a phrase maps to one period", () => {
	it("a parsed phrase with no period word names a day", () => {
		const found = suggestPeriods("2 days ago", parser({ "2 days ago": "2026-11-02" }), ALL);

		expect(found.map(({ granularity, date, label }) => [granularity, date.format("YYYY-MM-DD"), label])).toEqual([
			["day", "2026-11-02", "2 days ago"],
		]);
	});

	it("a period word in the phrase picks that granularity", () => {
		const parse = parser({ "in 2 weeks": "2026-11-18", "in 3 months": "2027-02-04", "in 2 years": "2028-11-04" });

		expect(suggestPeriods("in 2 weeks", parse, ALL).map((s) => s.granularity)).toEqual(["week"]);
		expect(suggestPeriods("in 3 months", parse, ALL).map((s) => s.granularity)).toEqual(["month"]);
		expect(suggestPeriods("in 2 years", parse, ALL).map((s) => s.granularity)).toEqual(["year"]);
	});

	it("a phrase the parser does not recognise maps to nothing", () => {
		expect(suggestPeriods("purple elephant", parser({}), ALL)).toEqual([]);
	});

	it("a period whose granularity is switched off is not offered", () => {
		const parse = parser({ "in 2 weeks": "2026-11-18", "next week": "2026-11-11" });

		expect(suggestPeriods("in 2 weeks", parse, ["day", "month", "year"])).toEqual([]);
		expect(suggestPeriods("next week", parse, ["day", "month", "year"])).toEqual([]);
	});

	it("never offers a quarter, which is reserved", () => {
		const parse = parser({ "next quarter": "2027-01-01", "in 2 quarters": "2027-04-01" });

		expect(suggestPeriods("next quarter", parse, ALL)).toEqual([]);
		expect(suggestPeriods("in 2 quarters", parse, ALL)).toEqual([]);
	});
});

describe("US-CMD-10: shortcuts complete a phrase as it is typed", () => {
	const parse = parser({
		today: "2026-11-04",
		tomorrow: "2026-11-05",
		yesterday: "2026-11-03",
		"this week": "2026-11-04",
		"this month": "2026-11-04",
		"this year": "2026-11-04",
		"last monday": "2026-11-02",
		"last week": "2026-10-28",
		"last month": "2026-10-04",
		"last year": "2025-11-04",
		"next monday": "2026-11-09",
		"next week": "2026-11-11",
	});

	it("an empty query offers today, yesterday, tomorrow and this, last and next week, month and year", () => {
		expect(suggestPeriods("", parse, ALL).map((s) => s.label)).toEqual([
			"Today",
			"Yesterday",
			"Tomorrow",
			"This week",
			"Last week",
			"Next week",
			"This month",
			"Last month",
			"Next month",
			"This year",
			"Last year",
			"Next year",
		].filter((label) => parse(label) !== null));
	});

	it("a prefix offers the shortcuts it starts, weekdays included, each resolved by the parser", () => {
		const found = suggestPeriods("last m", parse, ALL);

		expect(found.map(({ label, granularity, date }) => [label, granularity, date.format("YYYY-MM-DD")])).toEqual([
			["Last month", "month", "2026-10-04"],
			["Last Monday", "day", "2026-11-02"],
		]);
	});

	it("matching ignores case and surrounding spaces", () => {
		expect(suggestPeriods("  NEXT WEEK ", parse, ALL).map((s) => [s.label, s.granularity])).toEqual([["Next week", "week"]]);
	});

	it("a shortcut for a switched-off granularity is left out", () => {
		expect(suggestPeriods("this", parse, ["day"]).map((s) => s.granularity)).not.toContain("week");
	});
});
