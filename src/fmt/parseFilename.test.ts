import { describe, it, expect, afterEach } from "vitest";
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

describe("parseFilename — AC-FMT-04.1 a weekday token must match the date it names", () => {
	it("rejects a filename whose weekday name does not belong to the parsed date", () => {
		// 2024-01-01 is a real Monday — no date ever formats to "..., Tuesday".
		const result = parseFilename("2024-01-01, Tuesday.md", "YYYY-MM-DD, dddd", false);
		expect(result).toBeNull();
	});
});

describe("parseFilename — AC-FMT-04.1 out-of-range week values are rejected", () => {
	it("does not accept a week number no real date could produce", () => {
		// moment normalises isoWeek(99) into some other real week instead of
		// failing outright — the round-trip check must catch that.
		const result = parseFilename("2027-W99", "GGGG-[W]WW", false);
		expect(result).toBeNull();
	});
});

describe("parseFilename — AC-FMT-04.1/.7 matching is case-sensitive", () => {
	it("rejects a lowercase literal that differs only in case from the format", () => {
		const result = parseFilename("2024-01 January - work.md", "YYYY-MM MMMM - [Work]", false);
		expect(result).toBeNull();
	});
});

describe("parseFilename — AC-FMT-04.2 an inconsistent full path falls back to the filename", () => {
	it("rejects a folder/filename year mismatch instead of silently keeping the folder's year", () => {
		// No real date produces "2024/2025-01-01" — the folder says 2024, the
		// filename says 2025. The full-path candidate must be rejected so the
		// basename-only fallback (matching "2025-01-01" alone) can still work.
		const result = parseFilename("2024/2025-01-01.md", "YYYY/YYYY-MM-DD", false);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2025-01-01");
	});
});

describe("parseFilename — locale week tokens use locale week semantics, not ISO", () => {
	it("resolves gggg/ww against the locale week year boundary, not the ISO one", () => {
		// ISO week 1 of 2027 starts Mon 2027-01-04; the "en"-locale week 1 of
		// 2027 is Sun 2026-12-27 .. Sat 2027-01-02, whose Monday is 2026-12-28
		// — an 8-day gap from the ISO answer. Only the locale-week API finds
		// the right week for a gggg/ww format.
		const result = parseFilename("2027-W01", "gggg-[W]ww", false);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2026-12-28");
	});

	it("resolves GGGG/WW against the ISO week year boundary", () => {
		const result = parseFilename("2027-W01", "GGGG-[W]WW", false);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2027-01-04");
	});
});

describe("parseFilename — a nested weekday token names a different day of the same week", () => {
	// {{sunday:ddd}} always formats to "Sun", regardless of which week — it
	// must be checked against the Sunday of that week, not the note's own
	// Monday (whose weekday is always "Mon").
	const format = "gggg-[W]ww, {{monday:ddd}} - {{sunday:ddd}}";
	const monday = moment("2024-01-01");

	it("recognises an exact match", () => {
		const filename = formatWithWeekTokens(format, monday) + ".md";
		const result = parseFilename(filename, format, false);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2024-01-01");
		expect(result?.prefixMatch).toBe(false);
	});

	it("recognises a prefix match", () => {
		const filename = formatWithWeekTokens(format, monday) + " extra.md";
		const result = parseFilename(filename, format, true);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2024-01-01");
		expect(result?.prefixMatch).toBe(true);
	});
});

describe("parseFilename — a nested weekday token's own year may cross the week's year boundary", () => {
	// ISO week 53 of 2020 is Mon 2020-12-28 .. Sun 2021-01-03 — the week's own
	// year (2020) and the nested {{sunday:..}}'s year (2021) legitimately
	// disagree. That must not be treated as an inconsistent capture.
	it("resolves an ISO week whose nested Sunday fragment falls in the next calendar year", () => {
		const format = "Weeks/GGGG-[W]WW, {{monday:YYYY-MM-DD}} - {{sunday:YYYY-MM-DD}}";
		const result = parseFilename(
			"Weeks/2020-W53, 2020-12-28 - 2021-01-03.md",
			format,
			false,
		);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2020-12-28");
		expect(result?.prefixMatch).toBe(false);
	});

	it("resolves a locale week whose nested Sunday fragment falls in the next calendar year", () => {
		// Under the "en" locale, the Monday 2020-12-28 falls in locale week
		// 2021-W01 even though the week itself starts in December 2020.
		const format = "gggg-[W]ww, {{monday:YYYY-MM-DD}} - {{sunday:YYYY-MM-DD}}";
		const result = parseFilename(
			"2021-W01, 2020-12-28 - 2021-01-03.md",
			format,
			false,
		);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2020-12-28");
		expect(result?.prefixMatch).toBe(false);
	});
});

describe("parseFilename — locale week Monday selection holds for every week-start day", () => {
	afterEach(() => {
		moment.locale("en");
	});

	it.each([0, 1, 2, 3, 4, 5, 6])(
		"resolves the week's real Monday when the locale week starts on dow=%i",
		(dow) => {
			const localeName = `fmt04-test-dow-${dow}`;
			moment.updateLocale(localeName, { week: { dow, doy: 6 } });
			moment.locale(localeName);

			const format = "gggg-[W]ww";
			const filename = moment().weekYear(2027).week(3).format(format);

			// Independent oracle: walk forward from the locale week's real
			// start to the next ISO Monday, day by day (not the modulo
			// formula under test).
			const oracle = moment().weekYear(2027).week(3).startOf("week");
			while (oracle.isoWeekday() !== 1) oracle.add(1, "day");

			const result = parseFilename(filename, format, false);
			expect(result).not.toBeNull();
			expect(result?.date.format("YYYY-MM-DD")).toBe(oracle.format("YYYY-MM-DD"));
		},
	);
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
	it("recognises 211 consecutive daily notes named 'YYYY-MM-DD, dddd'", () => {
		const format = "YYYY-MM-DD, dddd";
		let day = moment("2024-01-01");
		for (let i = 0; i < 211; i++) {
			const filename = formatWithWeekTokens(format, day) + ".md";
			const result = parseFilename(filename, format, false);
			expect(result?.date.format("YYYY-MM-DD")).toBe(day.format("YYYY-MM-DD"));
			day = day.clone().add(1, "day");
		}
	});

	it("recognises 60 consecutive weekly notes via the configured 'gggg-[W]ww' format with prefix matching", () => {
		// The real vault's weekly granularity is configured with the bare
		// "gggg-[W]ww" format and allowPrefixMatch on; each file's descriptive
		// "DD.MM - DD.MM" range is NOT part of the configured format, so these
		// are recognised as prefix matches, not exact ones.
		const format = "gggg-[W]ww";
		let monday = moment("2024-01-01"); // Monday, ISO week 1 of 2024
		for (let i = 0; i < 60; i++) {
			const weekLabel = formatWithWeekTokens(format, monday);
			const sunday = monday.clone().add(6, "days");
			const filename = `${weekLabel}, ${monday.format("DD.MM")} - ${sunday.format("DD.MM")}.md`;
			const result = parseFilename(filename, format, true);
			expect(result).not.toBeNull();
			expect(result?.date.format("YYYY-MM-DD")).toBe(monday.format("YYYY-MM-DD"));
			expect(result?.prefixMatch).toBe(true);
			monday = monday.clone().add(1, "week");
		}
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

	// One representative case stands for all 7 historical bare-date files —
	// same shape, different dates, so each is an independent instance of the
	// same regex mismatch. A couple more dates guard against an off-by-one in
	// the date component itself rather than the shape check.
	it.each(["2024-03-05.md", "2022-07-19.md", "2023-12-31.md"])(
		"does not recognise the older bare 'YYYY-MM-DD.md' shape (%s)",
		(filename) => {
			const result = parseFilename(filename, format, false);
			expect(result).toBeNull();
		},
	);

	it("does not recognise a filename using an en dash instead of a hyphen between month and day", () => {
		const result = parseFilename("2024-03–05, Tuesday.md", format, false);
		expect(result).toBeNull();
	});
});
