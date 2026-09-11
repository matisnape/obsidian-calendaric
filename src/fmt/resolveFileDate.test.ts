import { describe, it, expect } from "vitest";
import moment from "moment";
import { resolveFileDate } from "./resolveFileDate";
import { computeNoteDate } from "./noteDate";
import { DEFAULT_PERIODIC_CONFIG } from "../types";
import type { PeriodicConfig } from "../types";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";

function config(format: string, folder: string): PeriodicConfig {
	return { ...DEFAULT_PERIODIC_CONFIG, enabled: true, format, folder };
}

const CONFIGS = {
	day: config("YYYY-MM-DD", "Daily"),
	week: config("GGGG-[W]WW", "Weekly"),
};

const NO_DEFAULT_FOLDER = new FakeVaultConfigPort("");

describe("resolveFileDate — AC-FMT-07.1 a daily filename under the daily folder", () => {
	it("recognises the file as that day's note", () => {
		const result = resolveFileDate("Daily/2026-04-13.md", CONFIGS, NO_DEFAULT_FOLDER);

		expect(result?.granularity).toBe("day");
		expect(result?.date.format("YYYY-MM-DD")).toBe("2026-04-13");
	});

	it("recognises a note nested in a subfolder under the configured folder", () => {
		// AC-FMT-07.1 scopes by folder, not by depth: the file is under Daily
		// and its filename is a valid daily name, so it is that day's note.
		const result = resolveFileDate("Daily/Sub/2026-04-13.md", CONFIGS, NO_DEFAULT_FOLDER);

		expect(result?.granularity).toBe("day");
		expect(result?.date.format("YYYY-MM-DD")).toBe("2026-04-13");
	});

	it("resolves against the default new-file folder when no folder is configured", () => {
		const configs = { day: config("YYYY-MM-DD", ""), week: config("GGGG-[W]WW", "") };
		const vaultConfig = new FakeVaultConfigPort("Journal");

		expect(resolveFileDate("Journal/2026-04-13.md", configs, vaultConfig)?.granularity).toBe("day");
		expect(resolveFileDate("2026-04-13.md", configs, vaultConfig)).toBeNull();
	});
});

describe("resolveFileDate — AC-FMT-07.2 a weekly filename that is no valid daily name", () => {
	it("recognises the file as that week's note", () => {
		const result = resolveFileDate("Weekly/2026-W16.md", CONFIGS, NO_DEFAULT_FOLDER);

		expect(result?.granularity).toBe("week");
		expect(result?.date.format("YYYY-MM-DD")).toBe("2026-04-13");
	});
});

describe("resolveFileDate — AC-FMT-07.2 day is tried before week", () => {
	it("returns the day identity when one filename satisfies both formats", () => {
		const configs = { day: config("YYYY-MM-DD", "Notes"), week: config("YYYY-MM-DD", "Notes") };

		expect(resolveFileDate("Notes/2026-04-13.md", configs, NO_DEFAULT_FOLDER)?.granularity).toBe("day");
	});
});

describe("resolveFileDate — AC-FMT-07.3 a filename matching neither format", () => {
	it("returns no identity for a name carrying extra text, with prefix matching off", () => {
		expect(resolveFileDate("Daily/2026-04-13 meeting.md", CONFIGS, NO_DEFAULT_FOLDER)).toBeNull();
	});

	it("returns no identity for a name carrying no date at all", () => {
		expect(resolveFileDate("Daily/Inbox.md", CONFIGS, NO_DEFAULT_FOLDER)).toBeNull();
	});
});

describe("resolveFileDate — AC-FMT-07.4 the identity equals the one computed elsewhere", () => {
	it("produces the day identity the calendar grid produces for the same date", () => {
		const result = resolveFileDate("Daily/2026-04-13.md", CONFIGS, NO_DEFAULT_FOLDER);
		const gridCell = moment("2026-04-13T17:30:00");

		expect(result?.noteDate).toBe(computeNoteDate(gridCell, "day"));
	});

	it("produces the week identity the calendar grid produces for any day of that week", () => {
		const result = resolveFileDate("Weekly/2026-W16.md", CONFIGS, NO_DEFAULT_FOLDER);
		// Wednesday of the same week — a week identity must not depend on which
		// day of the week the caller happens to hold.
		const gridCell = moment("2026-04-15T09:00:00");

		expect(result?.noteDate).toBe(computeNoteDate(gridCell, "week"));
	});

	it("gives the Sunday that ends the week the same identity as that week's note", () => {
		const result = resolveFileDate("Weekly/2026-W16.md", CONFIGS, NO_DEFAULT_FOLDER);
		// ISO week 16 runs Mon 2026-04-13 .. Sun 2026-04-19, and a note created
		// from that Sunday is written as "2026-W16" — so the grid's Sunday cell
		// must resolve to the identity of the file it would open.
		const gridCell = moment("2026-04-19T09:00:00");

		expect(result?.noteDate).toBe(computeNoteDate(gridCell, "week"));
	});

	it("does not give the Sunday of the previous week that week's identity", () => {
		const result = resolveFileDate("Weekly/2026-W16.md", CONFIGS, NO_DEFAULT_FOLDER);
		// Sun 2026-04-12 belongs to ISO week 15 and a note created from it is
		// written as "2026-W15" — it must never collide with week 16's note.
		const gridCell = moment("2026-04-12T09:00:00");

		// Asserted before the comparison: a null identity would satisfy
		// .not.toBe on its own and hide a resolution that stopped working.
		expect(result?.noteDate).toBeTypeOf("string");
		expect(result?.noteDate).not.toBe(computeNoteDate(gridCell, "week", CONFIGS.week.format));
	});

	it("never gives a day-note and a week-note of the same date one identity", () => {
		const day = resolveFileDate("Daily/2026-04-13.md", CONFIGS, NO_DEFAULT_FOLDER);
		const week = resolveFileDate("Weekly/2026-W16.md", CONFIGS, NO_DEFAULT_FOLDER);

		expect(day?.noteDate).toBeTypeOf("string");
		expect(week?.noteDate).toBeTypeOf("string");
		expect(day?.noteDate).not.toBe(week?.noteDate);
	});
});

describe("resolveFileDate — AC-FMT-07.4 the configured week format decides the week", () => {
	// A locale-week format numbers the week Sun 2026-04-12 .. Sat 2026-04-18 as
	// week 16, while an ISO format numbers Mon 2026-04-13 .. Sun 2026-04-19 as
	// week 16. Both filenames parse back to the same Monday, so only the
	// configured format can say which Sunday belongs to the note.
	const LOCALE_CONFIGS = {
		day: config("YYYY-MM-DD", "Daily"),
		week: config("gggg-[W]ww", "Weekly"),
	};

	it("puts the Sunday that opens a locale week inside that week's note", () => {
		const result = resolveFileDate("Weekly/2026-W16.md", LOCALE_CONFIGS, NO_DEFAULT_FOLDER);
		const gridCell = moment("2026-04-12T09:00:00");

		expect(result?.noteDate).toBe(computeNoteDate(gridCell, "week", LOCALE_CONFIGS.week.format));
	});

	it("keeps the Sunday that opens the next locale week out of it", () => {
		const result = resolveFileDate("Weekly/2026-W16.md", LOCALE_CONFIGS, NO_DEFAULT_FOLDER);
		const gridCell = moment("2026-04-19T09:00:00");

		expect(result?.noteDate).toBeTypeOf("string");
		expect(result?.noteDate).not.toBe(computeNoteDate(gridCell, "week", LOCALE_CONFIGS.week.format));
	});

	it("gives the two Sundays opposite answers under the two formats", () => {
		const isoNote = resolveFileDate("Weekly/2026-W16.md", CONFIGS, NO_DEFAULT_FOLDER);
		const localeNote = resolveFileDate("Weekly/2026-W16.md", LOCALE_CONFIGS, NO_DEFAULT_FOLDER);
		const openingSunday = moment("2026-04-12T09:00:00");
		const closingSunday = moment("2026-04-19T09:00:00");

		expect(isoNote?.noteDate).toBe(computeNoteDate(closingSunday, "week", CONFIGS.week.format));
		expect(localeNote?.noteDate).toBe(computeNoteDate(openingSunday, "week", LOCALE_CONFIGS.week.format));
		expect(isoNote?.noteDate).not.toBe(localeNote?.noteDate);
	});
});

describe("resolveFileDate — AC-FMT-07.4 identity agrees with the filename across a year boundary", () => {
	// The two systems disagree about the whole week-year here: Mon 2026-12-28
	// is "2026-W53" under GGGG/WW and "2027-W01" under gggg/ww. Whichever
	// weekStart the grid is drawn with, a grid cell is a day, so the property
	// that has to hold is per-day: a date shares the note's identity exactly
	// when the configured format would write that date into the note's name.
	for (const weekFormat of ["GGGG-[W]WW", "gggg-[W]ww"]) {
		it(`matches every day to the note "${weekFormat}" writes it into`, () => {
			const configs = { day: config("YYYY-MM-DD", "Daily"), week: config(weekFormat, "Weekly") };
			const noteName = moment("2026-12-28T12:00:00").format(weekFormat);
			const note = resolveFileDate(`Weekly/${noteName}.md`, configs, NO_DEFAULT_FOLDER);

			expect(note?.noteDate).toBeTypeOf("string");

			for (let offset = -14; offset <= 14; offset++) {
				const day = moment("2026-12-28T12:00:00").add(offset, "days");
				const belongsToNote = day.format(weekFormat) === noteName;

				expect(computeNoteDate(day, "week", weekFormat) === note?.noteDate).toBe(belongsToNote);
			}
		});
	}
});

describe("resolveFileDate — AC-FMT-07.5 a daily filename outside the daily folder", () => {
	it("is not recognised as that day's note when the file sits at the vault root", () => {
		expect(resolveFileDate("2026-04-13.md", CONFIGS, NO_DEFAULT_FOLDER)).toBeNull();
	});

	// A nested format makes the folder check load-bearing: parseFilename falls
	// back to the filename alone (AC-FMT-04.2), so without folder scoping these
	// two would resolve from any folder in the vault.
	const NESTED = { day: config("YYYY/YYYY-MM-DD", "Daily"), week: config("GGGG-[W]WW", "Weekly") };

	it("is not recognised as that day's note when the file sits in another folder", () => {
		expect(resolveFileDate("Daily/2026/2026-04-13.md", NESTED, NO_DEFAULT_FOLDER)?.granularity).toBe("day");
		expect(resolveFileDate("Archive/2026/2026-04-13.md", NESTED, NO_DEFAULT_FOLDER)).toBeNull();
	});

	it("is not recognised when the folder name only shares a prefix with the configured one", () => {
		expect(resolveFileDate("DailyArchive/2026/2026-04-13.md", NESTED, NO_DEFAULT_FOLDER)).toBeNull();
	});
});
