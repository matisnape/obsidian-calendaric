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
	it("resolves an ISO week whose nested Sunday fragment falls in the next calendar year, via the full nested path", () => {
		// "GGGG/[W]WW, ..." (folder "GGGG", filename "[W]WW, ...") — a bare
		// "Weeks/" literal would be misread by the tokenizer itself (its "W"
		// is a real moment token unless bracket-escaped as "[Weeks]"), which
		// would make this test pass through the basename-only fallback
		// instead of actually exercising a full nested-path match.
		const format = "GGGG/[W]WW, {{monday:YYYY-MM-DD}} - {{sunday:YYYY-MM-DD}}";
		const result = parseFilename(
			"2020/W53, 2020-12-28 - 2021-01-03.md",
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

describe("parseFilename — a nested date fragment is still checked when no week number decides the date", () => {
	// "YYYY/MM-DD, {{monday:YYYY-MM-DD}}" has no week-number token, so the
	// AC-FMT-04.5 priority rule doesn't apply — the nested Monday fragment is
	// the only descriptive text here and must actually describe the real
	// Monday of the parsed date's week, not arbitrary digits.
	const format = "YYYY/MM-DD, {{monday:YYYY-MM-DD}}";

	it("rejects a nested fragment that could never format from any date", () => {
		const result = parseFilename("2024/01-10, 1900-99-99.md", format, false);
		expect(result).toBeNull();
	});

	it("accepts a nested fragment that correctly names the date's real Monday", () => {
		// 2024-01-10 is a Wednesday; the Monday of its ISO week is 2024-01-08.
		const result = parseFilename("2024/01-10, 2024-01-08.md", format, false);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2024-01-10");
	});

	it("rejects two disagreeing captures of the same field inside one nested fragment", () => {
		// {{monday:YYYY/YYYY-MM-DD}} can only ever format both YYYYs to the
		// same real year — a filename with two different years there could
		// never come from any date.
		const withMismatch = "YYYY-MM-DD, {{monday:YYYY/YYYY-MM-DD}}";
		const result = parseFilename("2024-01-10, 1900/2024-01-08.md", withMismatch, false);
		expect(result).toBeNull();
	});

	it("rejects a nested week-number token whose value doesn't belong to the real day", () => {
		// {{monday:GGGG-[W]WW}} is a bizarre construction, but the same
		// invariant that catches every other wrong nested fragment catches
		// this one too, with no dedicated week-number-nesting logic needed.
		const withNestedWeek = "YYYY-MM-DD, {{monday:GGGG-[W]WW}}";
		const result = parseFilename("2024-01-10, 9999-W99.md", withNestedWeek, false);
		expect(result).toBeNull();
	});
});

describe("parseFilename — AC-FMT-04.5's tolerance is scoped to month/day fragments only, even on a week path", () => {
	// A week-number token grants tolerance for a conflicting month/day
	// fragment (AC-FMT-04.5) — it does not make the whole rendered string a
	// no-op. The decisive week text itself, and any nested year/week field,
	// must still reproduce exactly.
	it("rejects a non-padded week number written with a leading zero (exact match)", () => {
		// Real week 2 formats as "W2" under a bare "W" token — never "W02".
		const result = parseFilename("2024-W02", "GGGG-[W]W", false);
		expect(result).toBeNull();
	});

	it("rejects a non-padded week number written with a leading zero (prefix match)", () => {
		const result = parseFilename("2024-W02 extra", "GGGG-[W]W", true);
		expect(result).toBeNull();
	});

	it("rejects a conflicting nested week/year field even though a top-level week number decides the date (exact match)", () => {
		const format = "GGGG-[W]WW, {{monday:GGGG-[W]WW}}";
		const result = parseFilename("2024-W02, 9999-W99.md", format, false);
		expect(result).toBeNull();
	});

	it("rejects a conflicting nested week/year field even though a top-level week number decides the date (prefix match)", () => {
		const format = "GGGG-[W]WW, {{monday:GGGG-[W]WW}}";
		const result = parseFilename("2024-W02, 9999-W99 extra.md", format, true);
		expect(result).toBeNull();
	});

	// AC-FMT-04.5 names no restriction to a nested {{weekday:fmt}} wrapper —
	// "a month or day token" alongside a week-number token is tolerated
	// either way. ISO week 2 of 2024 starts Monday 2024-01-08.
	it("tolerates a conflicting month/day fragment that is not nested at all (exact match)", () => {
		const result = parseFilename("2024-W02, 99.99.md", "GGGG-[W]WW, DD.MM", false);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2024-01-08");
		expect(result?.prefixMatch).toBe(false);
	});

	it("tolerates a conflicting month/day fragment that is not nested at all (prefix match)", () => {
		const result = parseFilename("2024-W02, 99.99 extra.md", "GGGG-[W]WW, DD.MM", true);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2024-01-08");
		expect(result?.prefixMatch).toBe(true);
	});
});

describe("parseFilename — the core invariant: a match must reproduce its own text", () => {
	it("round-trips an arbitrary date through an arbitrary format and back", () => {
		const format = "YYYY/MM/YYYY-MM-DD, dddd";
		const date = moment("2025-06-17"); // a Tuesday
		const filename = formatWithWeekTokens(format, date) + ".md";
		const result = parseFilename(filename, format, false);
		expect(result).not.toBeNull();
		expect(result?.date.format("YYYY-MM-DD")).toBe("2025-06-17");
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

describe("parseFilename — a format that names its date only through {{weekday:fmt}}", () => {
	// formatWithWeekTokens turns the whole format into the wrapper's rendering,
	// so these are complete weekly formats on their own. A name the plugin
	// writes must parse back, or the note it just created is unrecognisable.
	it("reads back an ISO nested-only weekly format", () => {
		const format = "{{monday:GGGG-[W]WW}}";
		const written = formatWithWeekTokens(format, moment("2026-04-15"));

		expect(written).toBe("2026-W16");
		expect(parseFilename(written, format, false)?.date.format("YYYY-MM-DD")).toBe("2026-04-13");
	});

	it("reads back a locale nested-only weekly format", () => {
		const format = "{{monday:gggg-[W]ww}}";
		const written = formatWithWeekTokens(format, moment("2026-04-15"));

		expect(parseFilename(written, format, false)?.date.format("YYYY-MM-DD")).toBe("2026-04-13");
	});

	it("maps a wrapper naming another weekday back to that week's Monday", () => {
		// The wrapper renders the Friday, but the note is the week's, so the
		// date this returns must be the Monday every other weekly match returns.
		const format = "[Week ending ]{{friday:YYYY-MM-DD}}";
		const written = formatWithWeekTokens(format, moment("2026-04-15"));

		expect(written).toBe("Week ending 2026-04-17");
		expect(parseFilename(written, format, false)?.date.format("YYYY-MM-DD")).toBe("2026-04-13");
	});

	it("round-trips every day of a week to the one name that week is written under", () => {
		const format = "{{monday:GGGG-[W]WW}}";
		const names = new Set<string>();
		for (let offset = 0; offset < 7; offset++) {
			const day = moment("2026-04-13").add(offset, "days");
			const written = formatWithWeekTokens(format, day);
			names.add(written);
			expect(parseFilename(written, format, false)?.date.format("YYYY-MM-DD")).toBe("2026-04-13");
		}
		expect(names.size).toBe(1);
	});

	it("still round-trips the vault's own two-wrapper weekly format", () => {
		// AC-FMT-04.6's shipped shape: a top-level week number plus two
		// wrappers naming different days. Top-level construction owns this one,
		// and the wrapper fallback must not disturb it.
		const format = "GGGG-[W]WW[, ]{{monday:DD.MM}}[ - ]{{sunday:DD.MM}}";
		const written = formatWithWeekTokens(format, moment("2026-04-15"));

		expect(written).toBe("2026-W16, 13.04 - 19.04");
		expect(parseFilename(written, format, false)?.date.format("YYYY-MM-DD")).toBe("2026-04-13");
	});

	it("returns nothing when no wrapper carries enough to build a date", () => {
		expect(parseFilename("Monday", "{{monday:dddd}}", false)).toBeNull();
	});
});

describe("parseFilename — a wrapper names a weekday, and the inversion must recover it", () => {
	const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
	const SOURCE = "2026-04-15";
	const ISO_MONDAY = "2026-04-13";

	afterEach(() => {
		moment.locale("en");
	});

	it("reads back a Sunday wrapper numbering its own locale week", () => {
		// Under en the locale week starts on Sunday, so the wrapped Sunday
		// 2026-04-19 opens locale week 17 while belonging to ISO week 16. Taking
		// the numbered week's start would land on Monday 04-20, a week late.
		const format = "{{sunday:gggg-[W]ww}}";
		const written = formatWithWeekTokens(format, moment(SOURCE));

		expect(written).toBe("2026-W17");
		expect(parseFilename(written, format, false)?.date.format("YYYY-MM-DD")).toBe(ISO_MONDAY);
	});

	for (const locale of ["en", "en-gb"]) {
		it(`recovers every weekday wrapper under the ${locale} locale, both week systems`, () => {
			moment.locale(locale);

			for (const weekday of WEEKDAYS) {
				for (const inner of ["GGGG-[W]WW", "gggg-[W]ww", "YYYY-MM-DD"]) {
					const format = `{{${weekday}:${inner}}}`;
					const written = formatWithWeekTokens(format, moment(SOURCE));
					const parsed = parseFilename(written, format, false);

					expect(`${format} ${written} -> ${parsed?.date.format("YYYY-MM-DD") ?? "null"}`)
						.toBe(`${format} ${written} -> ${ISO_MONDAY}`);
				}
			}
		});
	}

	it("reads back two wrappers that number their weeks in different systems", () => {
		const format = "{{sunday:gggg-[W]ww}}[-]{{monday:GGGG-[W]WW}}";
		const written = formatWithWeekTokens(format, moment(SOURCE));

		expect(written).toBe("2026-W17-2026-W16");
		expect(parseFilename(written, format, false)?.date.format("YYYY-MM-DD")).toBe(ISO_MONDAY);
	});
});

describe("parseFilename — backslash escapes, as moment renders them", () => {
	it("reads back a literal W written with a backslash escape", () => {
		const format = "GGGG-\\WWW";
		const written = formatWithWeekTokens(format, moment("2026-04-15"));

		// The escape consumes exactly one token: "\WW" is the literal "WW" and
		// the third W is a real ISO week token.
		expect(written).toBe("2026-WW16");
		expect(parseFilename(written, format, false)?.date.format("YYYY-MM-DD")).toBe("2026-04-13");
	});

	it("reads back a single escaped token character", () => {
		const format = "YYYY-MM-DD\\D";
		const written = formatWithWeekTokens(format, moment("2026-01-05"));

		expect(written).toBe("2026-01-05D");
		expect(parseFilename(written, format, false)?.date.format("YYYY-MM-DD")).toBe("2026-01-05");
	});

	it("reads back an escaped run that moment takes as one whole token", () => {
		const format = "\\YYYY[ ]YYYY-MM-DD";
		const written = formatWithWeekTokens(format, moment("2026-01-05"));

		expect(written).toBe("YYYY 2026-01-05");
		expect(parseFilename(written, format, false)?.date.format("YYYY-MM-DD")).toBe("2026-01-05");
	});
});
