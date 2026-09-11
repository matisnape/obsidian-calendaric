import { describe, it, expect } from "vitest";
import moment from "moment";
import { computeNoteDate } from "./noteDate";

describe("computeNoteDate", () => {
	it("collapses two times on the same calendar day to the same day-note date", () => {
		const morning = moment("2026-04-13T08:00:00");
		const evening = moment("2026-04-13T21:45:00");

		expect(computeNoteDate(morning, "day")).toBe(computeNoteDate(evening, "day"));
	});

	it("does not mutate the input date", () => {
		const original = moment("2026-04-13T14:30:00");
		const before = original.valueOf();

		computeNoteDate(original, "week");

		expect(original.valueOf()).toBe(before);
	});

	it("produces different note dates for different granularities of the same instant", () => {
		const date = moment("2026-04-13T14:30:00");

		expect(computeNoteDate(date, "day")).not.toBe(computeNoteDate(date, "week"));
	});

	it("defaults to day granularity when none is given", () => {
		const date = moment("2026-04-13T14:30:00");

		expect(computeNoteDate(date)).toBe(computeNoteDate(date, "day"));
	});

	it("gives all seven days of one ISO week the same week note date", () => {
		// The week a note belongs to is the ISO week: noteUtils writes weekly
		// filenames from GGGG/WW and resolves {{monday:..}} through
		// isoWeekday(1). A locale-sensitive week anchor would split Sunday off
		// into its own week and collide with the neighbouring week's note.
		const monday = moment("2026-04-13T00:00:00");
		const expected = computeNoteDate(monday, "week");

		// Pinned to the Monday itself, so the check still fails on a runner
		// whose locale already starts weeks on Monday.
		expect(expected).toBe(`week:${monday.valueOf()}`);

		for (let offset = 1; offset < 7; offset++) {
			const day = moment("2026-04-13T12:00:00").add(offset, "days");
			expect(computeNoteDate(day, "week")).toBe(expected);
		}
	});

	it("gives two neighbouring ISO weeks different week note dates across the Sunday boundary", () => {
		const endOfWeek15 = moment("2026-04-12T23:00:00");
		const startOfWeek16 = moment("2026-04-13T01:00:00");

		expect(computeNoteDate(endOfWeek15, "week")).not.toBe(computeNoteDate(startOfWeek16, "week"));
	});

	it("follows a locale-week format's own week boundary instead of the ISO one", () => {
		// "gggg-[W]ww" numbers weeks the way the active locale does, and the en
		// locale starts a week on Sunday — so this note's week runs
		// Sun 2026-04-12 .. Sat 2026-04-18, one day off the ISO week of the same
		// number. The format is what gets written into the filename, so the
		// format decides which week a date belongs to.
		const LOCALE_WEEK = "gggg-[W]ww";
		const openingSunday = moment("2026-04-12T09:00:00");
		const expected = computeNoteDate(openingSunday, "week", LOCALE_WEEK);

		expect(expected).toBe(`week:${moment("2026-04-12T00:00:00").valueOf()}`);
		expect(computeNoteDate(moment("2026-04-18T23:00:00"), "week", LOCALE_WEEK)).toBe(expected);
		expect(computeNoteDate(moment("2026-04-19T09:00:00"), "week", LOCALE_WEEK)).not.toBe(expected);
	});

	it("gives one Sunday two different weeks under an ISO and a locale format", () => {
		const sunday = moment("2026-04-12T09:00:00");

		expect(computeNoteDate(sunday, "week", "GGGG-[W]WW"))
			.not.toBe(computeNoteDate(sunday, "week", "gggg-[W]ww"));
	});

	it("keeps the ISO anchor for a weekly format carrying no week token", () => {
		// Nothing in the filename numbers a week, so there is no locale claim to
		// honour; noteUtils' {{monday:..}} convention is the remaining rule.
		const sunday = moment("2026-04-19T09:00:00");

		expect(computeNoteDate(sunday, "week", "[Week of ]YYYY-MM-DD")).toBe(computeNoteDate(sunday, "week"));
	});

	it("reads week tokens only where they are real, not inside an escaped literal", () => {
		// "[ww]" is literal text in a moment format, not a locale-week token, so
		// it must not flip the anchor away from ISO.
		const sunday = moment("2026-04-19T09:00:00");

		expect(computeNoteDate(sunday, "week", "GGGG-[Www]WW")).toBe(computeNoteDate(sunday, "week"));
	});

	it("splits a grid row that spans two weeks across the two notes it is written into", () => {
		// A row drawn with weekStart = Wednesday runs Wed 2026-04-15 .. Tue
		// 2026-04-21 and spans two ISO weeks: the plugin writes its Mon/Tue
		// cells into 2026-W17 and the rest into 2026-W16. Identity follows the
		// file, so such a row carries two identities. Forcing one identity per
		// row would give a cell the identity of a note the plugin would never
		// open for that cell — and the same note's days already fall in two
		// different rows, so no single anchor can make a row the unit.
		const WEEK_FORMAT = "GGGG-[W]WW";
		const row = [...Array(7)].map((_, i) => moment("2026-04-15T12:00:00").add(i, "days"));

		const filenames = new Set(row.map((day) => day.format(WEEK_FORMAT)));
		const identities = new Set(row.map((day) => computeNoteDate(day, "week", WEEK_FORMAT)));

		expect(filenames.size).toBe(2);
		expect(identities.size).toBe(filenames.size);
	});

	it("keeps two instants a few milliseconds apart on opposite sides of midnight on different note dates", () => {
		const beforeMidnight = moment("2026-04-13T23:59:59.999");
		const afterMidnight = moment("2026-04-14T00:00:00.000");

		expect(computeNoteDate(beforeMidnight, "day")).not.toBe(computeNoteDate(afterMidnight, "day"));
	});
});
