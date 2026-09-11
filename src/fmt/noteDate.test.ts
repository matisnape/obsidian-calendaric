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

	it("keeps two instants a few milliseconds apart on opposite sides of midnight on different note dates", () => {
		const beforeMidnight = moment("2026-04-13T23:59:59.999");
		const afterMidnight = moment("2026-04-14T00:00:00.000");

		expect(computeNoteDate(beforeMidnight, "day")).not.toBe(computeNoteDate(afterMidnight, "day"));
	});
});
