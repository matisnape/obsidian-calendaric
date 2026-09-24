import { describe, it, expect, beforeEach, afterEach } from "vitest";
import moment from "moment";
import {
	applyWeekTokens,
	formatWithWeekTokens,
	computeNotePath,
	getWeekNumber,
	resolveNoteFolder,
	checkNoteFolder,
	folderChainSegments,
	hasUnusableSegment,
} from "./noteUtils";
import type { PeriodicConfig } from "../types";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { applyLocale, restoreLocale } from "../fmt/locale";

/**
 * The plugin's default week start. {{weekday:fmt}} resolves within the
 * configured week (AC-FMT-03.2), and the weekday-span cases below were written
 * for a Monday one; the rest keep moment's own Sunday-start "en".
 */
const mondayStart = (): void => {
	applyLocale("en", "monday", "en");
};
afterEach(() => restoreLocale());

function makeConfig(overrides: Partial<PeriodicConfig> = {}): PeriodicConfig {
	return {
		enabled: true,
		format: "YYYY-MM-DD",
		folder: "",
		templatePath: "",
		allowPrefixMatch: false,
		openAtStartup: false,
		...overrides,
	};
}

// Apr 13, 2026 is Monday of ISO week 16
// isoWeekday(1)=Apr 13, isoWeekday(7)=Apr 19
const MONDAY = moment("2026-04-13"); // Monday, ISO week 16

// The numeric week-start values `resolveWeekStart` produces: moment's day(),
// 0=Sunday through 6=Saturday.
const MONDAY_START = 1;
const SUNDAY_START = 0;

describe("applyWeekTokens", () => {
	it("substitutes {{monday:DD.MM}}", () => {
		// MONDAY = Apr 13 (Mon W16), Monday of its own Monday-start week = Apr 13
		expect(applyWeekTokens("{{monday:DD.MM}}", MONDAY, MONDAY_START)).toBe("13.04");
	});

	it("substitutes {{sunday:DD.MM}}", () => {
		// Last day of the Monday-start week Apr 13–19 = Apr 19
		expect(applyWeekTokens("{{sunday:DD.MM}}", MONDAY, MONDAY_START)).toBe("19.04");
	});

	it("substitutes after moment.format() output (no week tokens remain)", () => {
		const afterMoment = "2026-W16, {{monday:DD.MM}} – {{sunday:DD.MM}}";
		expect(applyWeekTokens(afterMoment, MONDAY, MONDAY_START)).toBe("2026-W16, 13.04 – 19.04");
	});

	it("handles wednesday with YYYY-MM-DD format", () => {
		// Wed of week Apr 13–19 = Apr 15
		expect(applyWeekTokens("{{wednesday:YYYY-MM-DD}}", MONDAY, MONDAY_START)).toBe("2026-04-15");
	});

	it("is case-insensitive for weekday names", () => {
		expect(applyWeekTokens("{{Monday:DD.MM}}", MONDAY, MONDAY_START)).toBe("13.04");
		expect(applyWeekTokens("{{SUNDAY:DD.MM}}", MONDAY, MONDAY_START)).toBe("19.04");
	});

	it("leaves unrecognised tokens untouched", () => {
		expect(applyWeekTokens("{{date}}", MONDAY, MONDAY_START)).toBe("{{date}}");
	});

	it("is a no-op on strings without tokens", () => {
		expect(applyWeekTokens("2026-W16", MONDAY, MONDAY_START)).toBe("2026-W16");
	});

	// DEC-01: the week a token resolves inside is the note's OWN seven-day week,
	// counted from the configured start day. isoWeekday() would count from a
	// Monday whatever the setting says, which is the bug US-TPL-03 fixes.
	describe("honours the configured week start", () => {
		// Apr 12, 2026 is a Sunday. Under a Sunday-start week it OPENS the week
		// Apr 12–18, so that week's Monday is Apr 13, the next day. Under a
		// Monday-start week the same date CLOSES the week Apr 6–12, whose Monday
		// is Apr 6. One date, two weeks, two different Mondays.
		const SUNDAY = moment("2026-04-12");

		it("resolves {{monday:...}} forward from a Sunday that starts a Sunday-start week", () => {
			expect(applyWeekTokens("{{monday:YYYY-MM-DD}}", SUNDAY, SUNDAY_START)).toBe("2026-04-13");
		});

		it("resolves {{monday:...}} back from a Sunday that closes a Monday-start week", () => {
			expect(applyWeekTokens("{{monday:YYYY-MM-DD}}", SUNDAY, MONDAY_START)).toBe("2026-04-06");
		});

		it("keeps the whole Sunday-start week in one seven-day span", () => {
			const template = "{{sunday:DD.MM}}–{{saturday:DD.MM}}";
			expect(applyWeekTokens(template, SUNDAY, SUNDAY_START)).toBe("12.04–18.04");
		});

		it("resolves {{sunday:...}} to the week's own first day, not its last, on a Sunday-start week", () => {
			// A Monday-start reading of Apr 15 puts its Sunday on Apr 19; a
			// Sunday-start reading puts it on Apr 12, before the note's own date.
			const wednesday = moment("2026-04-15");
			expect(applyWeekTokens("{{sunday:DD.MM}}", wednesday, SUNDAY_START)).toBe("12.04");
			expect(applyWeekTokens("{{sunday:DD.MM}}", wednesday, MONDAY_START)).toBe("19.04");
		});

		it("counts the week from a start day that is neither Monday nor Sunday", () => {
			// weekStart = 4 (Thursday). Apr 15 is a Wednesday, so its Thursday-start
			// week opened on Apr 9 and its Monday is Apr 13.
			const wednesday = moment("2026-04-15");
			expect(applyWeekTokens("{{thursday:DD.MM}}|{{monday:DD.MM}}", wednesday, 4)).toBe("09.04|13.04");
		});
	});
});

describe("formatWithWeekTokens", () => {
	beforeEach(mondayStart);

	it("produces correct filename for full week range format", () => {
		const fmt = "gggg-[W]ww, {{monday:DD.MM}} – {{sunday:DD.MM}}";
		expect(formatWithWeekTokens(fmt, MONDAY, "week")).toBe("2026-W16, 13.04 – 19.04");
	});

	it("works for pure moment format without week tokens", () => {
		expect(formatWithWeekTokens("YYYY-MM-DD", MONDAY, "day")).toBe("2026-04-13");
	});
});

describe("computeNotePath", () => {
	beforeEach(mondayStart);

	const vaultConfig = new FakeVaultConfigPort();
	const dailyDate = moment("2026-04-13");

	it("builds path with folder", () => {
		const config = makeConfig({ format: "YYYY-MM-DD", folder: "journal/daily" });
		expect(computeNotePath(dailyDate, "day", config, vaultConfig)).toBe("journal/daily/2026-04-13.md");
	});

	it("builds path without folder (vault root)", () => {
		const config = makeConfig({ format: "YYYY-MM-DD", folder: "" });
		expect(computeNotePath(dailyDate, "day", config, vaultConfig)).toBe("2026-04-13.md");
	});

	it("applies week tokens for weekly format", () => {
		const config = makeConfig({
			format: "gggg-[W]ww, {{monday:DD.MM}} – {{sunday:DD.MM}}",
			folder: "journal/weekly",
		});
		expect(computeNotePath(MONDAY, "week", config, vaultConfig)).toBe("journal/weekly/2026-W16, 13.04 – 19.04.md");
	});

	it("uses Obsidian default folder when config folder is empty and newFileLocation=folder", () => {
		const configWithDefault = new FakeVaultConfigPort("Inbox");
		const config = makeConfig({ format: "YYYY-MM-DD", folder: "" });
		expect(computeNotePath(dailyDate, "day", config, configWithDefault)).toBe("Inbox/2026-04-13.md");
	});

	it("builds a vault-root path for an explicit \"/\" folder, ignoring the default folder", () => {
		const configWithDefault = new FakeVaultConfigPort("Inbox");
		const config = makeConfig({ format: "YYYY-MM-DD", folder: "/" });
		expect(computeNotePath(dailyDate, "day", config, configWithDefault)).toBe("2026-04-13.md");
	});
});

describe("resolveNoteFolder", () => {
	it("keeps a configured folder as-is", () => {
		expect(resolveNoteFolder("journal/daily", new FakeVaultConfigPort("Inbox"))).toBe("journal/daily");
	});

	it("falls back to Obsidian's default new-file folder when none is configured (AC-NOTE-03.2)", () => {
		expect(resolveNoteFolder("", new FakeVaultConfigPort("Inbox"))).toBe("Inbox");
	});

	it("resolves to the vault root when neither the config nor Obsidian names a folder (AC-NOTE-03.2)", () => {
		expect(resolveNoteFolder("", new FakeVaultConfigPort())).toBe("");
	});

	it("keeps an explicit \"/\" as the vault root instead of taking the default folder (AC-NOTE-03.3)", () => {
		expect(resolveNoteFolder("/", new FakeVaultConfigPort("Inbox"))).toBe("");
	});

	it("takes the default folder only when the config names no folder at all (AC-NOTE-03.2)", () => {
		expect(resolveNoteFolder("   ", new FakeVaultConfigPort("Inbox"))).toBe("Inbox");
	});

	it("strips surrounding slashes from a configured folder", () => {
		expect(resolveNoteFolder("/journal/daily/", new FakeVaultConfigPort("Inbox"))).toBe("journal/daily");
	});
});

describe("checkNoteFolder", () => {
	it("accepts an empty configured folder as valid and already present (AC-NOTE-03.3)", () => {
		const check = checkNoteFolder("", new FakeVaultConfigPort(), new FakeVaultPort());

		expect(check).toEqual({ path: "", valid: true, notYetCreated: false });
	});

	it("accepts the vault root written as a slash as valid and already present (AC-NOTE-03.3)", () => {
		const check = checkNoteFolder("/", new FakeVaultConfigPort(), new FakeVaultPort());

		expect(check).toEqual({ path: "", valid: true, notYetCreated: false });
	});

	it("reads an explicit \"/\" as the vault root even when Obsidian names a default folder (AC-NOTE-03.3)", () => {
		const check = checkNoteFolder("/", new FakeVaultConfigPort("Inbox"), new FakeVaultPort());

		expect(check).toEqual({ path: "", valid: true, notYetCreated: false });
	});

	it("reports an existing folder as valid and not pending creation", () => {
		const vault = new FakeVaultPort();
		vault.seedFolder("journal/daily");

		const check = checkNoteFolder("journal/daily", new FakeVaultConfigPort(), vault);

		expect(check).toEqual({ path: "journal/daily", valid: true, notYetCreated: false });
	});

	it("flags a folder that does not exist yet as valid but not-yet-created (AC-NOTE-03.4)", () => {
		const check = checkNoteFolder("journal/daily", new FakeVaultConfigPort(), new FakeVaultPort());

		expect(check).toEqual({ path: "journal/daily", valid: true, notYetCreated: true });
	});

	it("checks the fallback folder, not the empty config value, when no folder is configured (AC-NOTE-03.2)", () => {
		const check = checkNoteFolder("", new FakeVaultConfigPort("Inbox"), new FakeVaultPort());

		expect(check).toEqual({ path: "Inbox", valid: true, notYetCreated: true });
	});

	it("rejects a folder path already occupied by a file", () => {
		const vault = new FakeVaultPort();
		vault.seedFile("journal/daily", "a note, not a folder");

		const check = checkNoteFolder("journal/daily", new FakeVaultConfigPort(), vault);

		expect(check).toEqual({ path: "journal/daily", valid: false, notYetCreated: false });
	});

	it("rejects a file sitting on an intermediate segment of the chain", () => {
		const vault = new FakeVaultPort();
		vault.seedFile("journal", "a note where a parent folder belongs");

		const check = checkNoteFolder("journal/daily", new FakeVaultConfigPort(), vault);

		expect(check).toEqual({ path: "journal/daily", valid: false, notYetCreated: false });
	});

	it("reports a chain as pending when only its top folder exists", () => {
		const vault = new FakeVaultPort();
		vault.seedFolder("journal");

		const check = checkNoteFolder("journal/daily/2026", new FakeVaultConfigPort(), vault);

		expect(check).toEqual({ path: "journal/daily/2026", valid: true, notYetCreated: true });
	});

	it("reports a fully present chain as not pending", () => {
		const vault = new FakeVaultPort();
		vault.seedFolder("journal/daily/2026");

		const check = checkNoteFolder("journal/daily/2026", new FakeVaultConfigPort(), vault);

		expect(check).toEqual({ path: "journal/daily/2026", valid: true, notYetCreated: false });
	});

	it("rejects a path with an empty or dot segment", () => {
		const vault = new FakeVaultPort();

		expect(checkNoteFolder("journal//daily", new FakeVaultConfigPort(), vault).valid).toBe(false);
		expect(checkNoteFolder("journal/../daily", new FakeVaultConfigPort(), vault).valid).toBe(false);
	});
});

describe("hasUnusableSegment", () => {
	it("accepts the vault root, which has no segments", () => {
		expect(hasUnusableSegment("")).toBe(false);
	});

	it("accepts an ordinary chain", () => {
		expect(hasUnusableSegment("journal/daily/2026")).toBe(false);
	});

	it("rejects an empty, dot or double-dot segment", () => {
		expect(hasUnusableSegment("journal//daily")).toBe(true);
		expect(hasUnusableSegment("journal/./daily")).toBe(true);
		expect(hasUnusableSegment("journal/../daily")).toBe(true);
	});
});

describe("folderChainSegments", () => {
	it("lists every folder in the chain, shallowest first", () => {
		expect(folderChainSegments("journal/daily/2026")).toEqual([
			"journal",
			"journal/daily",
			"journal/daily/2026",
		]);
	});

	it("lists a single folder as the whole chain", () => {
		expect(folderChainSegments("journal")).toEqual(["journal"]);
	});

	it("lists nothing for the vault root", () => {
		expect(folderChainSegments("")).toEqual([]);
	});
});

describe("getWeekNumber", () => {
	// 2026-12-28 is a Monday where the two week systems disagree: the ISO week
	// calls it 2026-W53, the locale week calls it 2027-W01.
	const DIVERGENT = moment("2026-12-28");

	it("uses the ISO week when the format carries an ISO week token", () => {
		expect(getWeekNumber(DIVERGENT, "GGGG-[W]WW")).toBe(53);
	});

	it("uses the locale week when the format carries a locale week token", () => {
		expect(getWeekNumber(DIVERGENT, "gggg-[W]ww")).toBe(1);
	});

	it("reads the [W] of the default format as a literal, not as an ISO token", () => {
		expect(getWeekNumber(DIVERGENT, "gggg-[W]ww")).not.toBe(DIVERGENT.isoWeek());
	});

	it("ignores a week token nested inside {{weekday:fmt}}", () => {
		expect(getWeekNumber(DIVERGENT, "gggg-[W]ww, {{monday:GGGG-[W]WW}}")).toBe(1);
	});

	it("falls back to the locale week when the format names no week", () => {
		expect(getWeekNumber(DIVERGENT, "YYYY-MM-DD")).toBe(DIVERGENT.week());
	});

	it("agrees with the number formatWithWeekTokens writes into the filename", () => {
		for (const fmt of ["gggg-[W]ww", "GGGG-[W]WW"]) {
			const padded = String(getWeekNumber(DIVERGENT, fmt)).padStart(2, "0");
			expect(formatWithWeekTokens(fmt, DIVERGENT, "week")).toContain(`W${padded}`);
		}
	});
});

describe("getWeekNumber with awkward formats", () => {
	const DIVERGENT_DATE = moment("2026-12-28");

	it("ignores the WW inside a double-brace span that formatWithWeekTokens does not recognise", () => {
		// `notaday` is not a weekday, so the span is written as typed (AC-FMT-01.5)
		// and its WW is no ISO week number. The filename carries the locale week.
		const fmt = "gggg-[W]ww, {{notaday:WW}}";
		expect(formatWithWeekTokens(fmt, DIVERGENT_DATE, "week")).toBe("2027-W01, {{notaday:WW}}");
		expect(getWeekNumber(DIVERGENT_DATE, fmt)).toBe(1);
	});

	it("keeps an unterminated double-brace span", () => {
		const fmt = "gggg-[W]ww, {{monday:WW";
		expect(getWeekNumber(DIVERGENT_DATE, fmt)).toBe(53);
	});

	it("strips a recognised weekday span whatever its case", () => {
		expect(getWeekNumber(DIVERGENT_DATE, "gggg-[W]ww, {{MONDAY:GGGG-[W]WW}}")).toBe(1);
	});

	it("strips every recognised weekday name", () => {
		const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
		for (const day of days) {
			expect(getWeekNumber(DIVERGENT_DATE, `gggg-[W]ww, {{${day}:WW}}`)).toBe(1);
		}
	});

	it("is unaffected by a brace span that carries no week token", () => {
		expect(getWeekNumber(DIVERGENT_DATE, "GGGG-[W]WW, {{notaday:DD}}")).toBe(53);
	});
});

describe("getWeekNumber for nested-only formats", () => {
	beforeEach(mondayStart);

	// 2026-12-27 is a Sunday. The Monday its week token resolves to is 12-21, in
	// ISO week 52, while the date's own locale week is 1 — the review's case.
	const SUNDAY = moment("2026-12-27");

	it("numbers a nested-only ISO format by the weekday the token resolves to", () => {
		const fmt = "{{monday:GGGG-[W]WW}}";
		expect(formatWithWeekTokens(fmt, SUNDAY, "week")).toBe("2026-W52");
		expect(getWeekNumber(SUNDAY, fmt)).toBe(52);
	});

	it("numbers a nested-only locale format by the same weekday", () => {
		const fmt = "{{monday:gggg-[W]ww}}";
		const expected = SUNDAY.clone().isoWeekday(1).week();
		expect(expected).not.toBe(SUNDAY.week());
		expect(formatWithWeekTokens(fmt, SUNDAY, "week")).toContain(`W${String(expected).padStart(2, "0")}`);
		expect(getWeekNumber(SUNDAY, fmt)).toBe(expected);
	});

	it("prefers a top-level week token over a nested one", () => {
		expect(getWeekNumber(SUNDAY, "gggg-[W]ww, {{monday:GGGG-[W]WW}}")).toBe(SUNDAY.week());
	});

	it("skips a nested span that carries no week token", () => {
		const fmt = "{{monday:DD.MM}}, {{sunday:GGGG-[W]WW}}";
		expect(getWeekNumber(SUNDAY, fmt)).toBe(SUNDAY.clone().isoWeekday(7).isoWeek());
	});

	it("skips an unrecognised weekday span when looking for a nested token", () => {
		// `notaday` is written as typed (AC-FMT-01.5), so its WW names no week and
		// the format falls back to the locale week.
		expect(getWeekNumber(SUNDAY, "{{notaday:WW}}")).toBe(SUNDAY.week());
	});

	it("falls back to the locale week when no token anywhere names a week", () => {
		expect(getWeekNumber(SUNDAY, "{{monday:DD.MM}} – {{sunday:DD.MM}}")).toBe(SUNDAY.week());
	});
});

describe("getWeekNumber with moment escapes", () => {
	// 2026-12-27 is a Sunday in ISO week 52 whose own locale week is 1, so the
	// two systems cannot be confused for one another.
	const SUNDAY = moment("2026-12-27");

	it("ignores a backslash-escaped ISO token and uses the real locale one", () => {
		// moment renders this as "2026-WWW 01": the escaped WW is literal text and
		// the only week number in the name is the locale 01.
		const fmt = "GGGG-[W]\\WW ww";
		expect(formatWithWeekTokens(fmt, SUNDAY, "week")).toBe("2026-WWW 01");
		expect(getWeekNumber(SUNDAY, fmt)).toBe(SUNDAY.week());
	});

	it("falls back when every week token in the format is escaped", () => {
		const fmt = "YYYY-MM-DD \\WW";
		expect(formatWithWeekTokens(fmt, SUNDAY, "week")).toBe("2026-12-27 WW");
		expect(getWeekNumber(SUNDAY, fmt)).toBe(SUNDAY.week());
	});

	it("ignores a week token inside a bracket span", () => {
		const fmt = "[WW]ww";
		expect(formatWithWeekTokens(fmt, SUNDAY, "week")).toBe("WW01");
		expect(getWeekNumber(SUNDAY, fmt)).toBe(SUNDAY.week());
	});

	it("keeps reading tokens after an unterminated bracket", () => {
		// moment does not swallow the rest of the format; it prints the "[" and
		// carries on, rendering "2027-[5201" — so the ISO 52 is really in the name.
		const fmt = "gggg-[Www";
		expect(formatWithWeekTokens(fmt, SUNDAY, "week")).toBe("2027-[5201");
		expect(getWeekNumber(SUNDAY, fmt)).toBe(SUNDAY.isoWeek());
	});

	it("treats a doubled backslash as escaping the backslash, not the token", () => {
		const fmt = "\\\\W";
		expect(formatWithWeekTokens(fmt, SUNDAY, "week")).toBe("52");
		expect(getWeekNumber(SUNDAY, fmt)).toBe(SUNDAY.isoWeek());
	});

	it("applies the same escape rules inside a weekday span", () => {
		mondayStart();
		// 2027-01-03 resolves {{monday:...}} to 2026-12-28, whose ISO week is 53
		// and whose locale week is 1 — the escaped WW must not win.
		const date = moment("2027-01-03");
		const fmt = "{{monday:\\WW ww}}";
		expect(formatWithWeekTokens(fmt, date, "week")).toBe("WW 01");
		expect(getWeekNumber(date, fmt)).toBe(date.clone().isoWeekday(1).week());
	});
});

describe("getWeekNumber escape permutations", () => {
	// 2026-12-27 is a Sunday in ISO week 52 whose own locale week is 1, so an
	// ISO answer and a locale answer can never be mistaken for one another.
	const DATE = moment("2026-12-27");

	// `writes` is what moment renders for the format, measured rather than
	// reasoned about; `weekNumber` is the number that name really carries.
	const CASES: { format: string; writes: string; weekNumber: number }[] = [
		{ format: "gggg-[W]ww", writes: "2027-W01", weekNumber: 1 },
		{ format: "GGGG-[W]WW", writes: "2026-W52", weekNumber: 52 },
		{ format: "[WW]ww", writes: "WW01", weekNumber: 1 },
		{ format: "gggg-[Www", writes: "2027-[5201", weekNumber: 52 },
		{ format: "[\\W]WW", writes: "\\W52", weekNumber: 52 },
		{ format: "\\WW", writes: "WW", weekNumber: 1 },
		{ format: "\\WWW", writes: "WW52", weekNumber: 52 },
		{ format: "\\WWW ww", writes: "WW52 01", weekNumber: 52 },
		{ format: "\\www", writes: "ww1", weekNumber: 1 },
		{ format: "\\W W", writes: "W 52", weekNumber: 52 },
		{ format: "\\\\W", writes: "52", weekNumber: 52 },
		{ format: "\\[WW", writes: "[52", weekNumber: 52 },
		{ format: "\\Wo", writes: "Wo", weekNumber: 1 },
		{ format: "\\Wow", writes: "Wo1", weekNumber: 1 },
		{ format: "ww\\WW", writes: "01WW", weekNumber: 1 },
	];

	for (const { format, writes, weekNumber } of CASES) {
		it(`${JSON.stringify(format)} writes ${JSON.stringify(writes)}, numbered ${weekNumber}`, () => {
			expect(formatWithWeekTokens(format, DATE, "week")).toBe(writes);
			expect(getWeekNumber(DATE, format)).toBe(weekNumber);
		});
	}
});

describe("getWeekNumber escape permutations inside a weekday span", () => {
	beforeEach(mondayStart);

	// 2027-01-03 resolves {{monday:...}} to 2026-12-28, whose ISO week is 53 and
	// whose locale week is 1, while the date's own locale week is 2.
	const DATE = moment("2027-01-03");

	const CASES: { format: string; writes: string; weekNumber: number }[] = [
		{ format: "{{monday:\\WWW}}", writes: "WW53", weekNumber: 53 },
		{ format: "{{monday:\\WW ww}}", writes: "WW 01", weekNumber: 1 },
		{ format: "{{monday:\\WW}}", writes: "WW", weekNumber: 2 },
		{ format: "{{monday:[WW]ww}}", writes: "WW01", weekNumber: 1 },
	];

	for (const { format, writes, weekNumber } of CASES) {
		it(`${JSON.stringify(format)} writes ${JSON.stringify(writes)}, numbered ${weekNumber}`, () => {
			expect(formatWithWeekTokens(format, DATE, "week")).toBe(writes);
			expect(getWeekNumber(DATE, format)).toBe(weekNumber);
		});
	}
});
