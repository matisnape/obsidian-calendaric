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

	it("keeps two instants a few milliseconds apart on opposite sides of midnight on different note dates", () => {
		const beforeMidnight = moment("2026-04-13T23:59:59.999");
		const afterMidnight = moment("2026-04-14T00:00:00.000");

		expect(computeNoteDate(beforeMidnight, "day")).not.toBe(computeNoteDate(afterMidnight, "day"));
	});
});
