import { describe, it, expect } from "vitest";
import moment from "moment";
import { parseFilename } from "./parseFilename";
import { formatWithWeekTokens } from "../notes/noteUtils";

describe("parseFilename — AC-FMT-04.1 nested folder, exact full-path match", () => {
	it("recognises a file whose full relative path matches a nested format", () => {
		const result = parseFilename("2024/2024-03-05.md", "YYYY/YYYY-MM-DD", false);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2024-03-05");
		expect(result?.prefixMatch).toBe(false);
	});
});

describe("parseFilename — AC-FMT-04.2 moved out of its nested folder", () => {
	it("still recognises the file by its filename alone", () => {
		const result = parseFilename("2024-03-05.md", "YYYY/YYYY-MM-DD", false);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2024-03-05");
		expect(result?.prefixMatch).toBe(false);
	});
});

describe("parseFilename — AC-FMT-04.3 prefix matching disabled (default)", () => {
	it("does not recognise a filename that only starts with the formatted date", () => {
		const result = parseFilename("2024-03-05 meeting notes.md", "YYYY-MM-DD", false);
		expect(result).toBeNull();
	});
});

describe("parseFilename — AC-FMT-04.4 prefix matching enabled", () => {
	it("recognises the same filename as an inexact prefix match", () => {
		const result = parseFilename("2024-03-05 meeting notes.md", "YYYY-MM-DD", true);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2024-03-05");
		expect(result?.prefixMatch).toBe(true);
	});
});

describe("parseFilename — AC-FMT-04.5 week number beats a conflicting month/day fragment", () => {
	const format = "gggg-[W]ww, {{monday:DD.MM}} - {{sunday:DD.MM}}";

	it("uses the week number when the weekday-token fragment disagrees (exact match)", () => {
		// ISO week 1 of 2024 is Mon 2024-01-01 .. Sun 2024-01-07. The fragment
		// below is deliberately bogus so only the week-number path can win.
		const result = parseFilename("2024-W01, 99.99 - 07.01.md", format, false);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2024-01-01");
	});

	it("uses the week number when the weekday-token fragment disagrees (prefix match)", () => {
		const result = parseFilename("2024-W01, 99.99 - 07.01 extra.md", format, true);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2024-01-01");
		expect(result?.prefixMatch).toBe(true);
	});
});

describe("parseFilename — AC-FMT-04.6 real-vault regression: every existing note is recognised", () => {
	it("recognises a full year of daily notes named 'YYYY-MM-DD, dddd'", () => {
		const format = "YYYY-MM-DD, dddd";
		let day = moment("2024-01-01");
		const end = moment("2024-12-31");
		let count = 0;
		while (day.isSameOrBefore(end)) {
			const filename = formatWithWeekTokens(format, day) + ".md";
			const result = parseFilename(filename, format, false);
			expect(result?.date.format("YYYY-MM-DD")).toBe(day.format("YYYY-MM-DD"));
			day = day.clone().add(1, "day");
			count++;
		}
		expect(count).toBeGreaterThanOrEqual(211);
	});

	it("recognises every ISO week of a year as weekly notes 'gggg-[W]ww, {{monday:DD.MM}} - {{sunday:DD.MM}}'", () => {
		const format = "gggg-[W]ww, {{monday:DD.MM}} - {{sunday:DD.MM}}";
		let monday = moment("2024-01-01"); // Monday, ISO week 1 of 2024
		let count = 0;
		for (let i = 0; i < 60; i++) {
			const filename = formatWithWeekTokens(format, monday) + ".md";
			const result = parseFilename(filename, format, false);
			expect(result?.date.format("YYYY-MM-DD")).toBe(monday.format("YYYY-MM-DD"));
			monday = monday.clone().add(1, "week");
			count++;
		}
		expect(count).toBeGreaterThanOrEqual(60);
	});

	it("recognises every month of a year as monthly notes 'YYYY-MM MMMM'", () => {
		const format = "YYYY-MM MMMM";
		for (let m = 0; m < 21; m++) {
			const date = moment("2024-01-01").add(m, "month");
			const filename = date.format(format) + ".md";
			const result = parseFilename(filename, format, false);
			expect(result?.date.format("YYYY-MM")).toBe(date.format("YYYY-MM"));
		}
	});

	it("recognises every month of a year as monthly-work notes 'YYYY-MM MMMM - [Work]'", () => {
		const format = "YYYY-MM MMMM - [Work]";
		for (let m = 0; m < 25; m++) {
			const date = moment("2024-01-01").add(m, "month");
			const filename = date.format(format) + ".md";
			const result = parseFilename(filename, format, false);
			expect(result?.date.format("YYYY-MM")).toBe(date.format("YYYY-MM"));
		}
	});
});

describe("parseFilename — AC-FMT-04.7 real-vault regression: old shapes stay unrecognised", () => {
	const format = "YYYY-MM-DD, dddd";

	it("does not recognise the older bare 'YYYY-MM-DD.md' shape", () => {
		const result = parseFilename("2024-03-05.md", format, false);
		expect(result).toBeNull();
	});

	it("does not recognise a filename using an en dash instead of a hyphen between month and day", () => {
		const result = parseFilename("2024-03–05, Tuesday.md", format, false);
		expect(result).toBeNull();
	});
});
