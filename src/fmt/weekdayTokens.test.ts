import { afterEach, describe, expect, it } from "vitest";
import type { PeriodicConfig, ReleaseGranularity } from "../types";
import { computeNotePath, formatWithWeekTokens, getWeekNumber } from "../notes/noteUtils";
import { openOrCreatePeriodNote, startUp } from "../notes/periodNoteOpen";
import { substituteTemplateTokens } from "../notes/templateTokens";
import { openOrCreateNote } from "../ui/cellActions";
import { DotScanner } from "../ui/calendarDots";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { resolveFileDate } from "./resolveFileDate";
import { parseFilename } from "./parseFilename";
import { computeNoteDate } from "./noteDate";
import { applyLocale, restoreLocale } from "./locale";
import { validateFormat } from "./validateFormat";

// Read off the window, never imported from the package (no-restricted-imports).
type Moment = ReturnType<typeof window.moment>;

afterEach(() => restoreLocale());

// Sun 2026-04-12: the last day of the Monday-start week 6–12 April, and the
// first day of the Sunday-start week 12–18 April. Made after applyLocale, since
// a moment keeps the week rules of the locale it was made under.
const sunday = () => window.moment("2026-04-12");

const config = (overrides: Partial<PeriodicConfig>): PeriodicConfig => ({
	enabled: true,
	format: "YYYY-MM-DD",
	folder: "Daily",
	templatePath: "",
	allowPrefixMatch: false,
	openAtStartup: false,
	...overrides,
});

const ports = () => ({ vault: new FakeVaultPort(), vaultConfig: new FakeVaultConfigPort(), workspace: new FakeWorkspacePort() });

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

	it.each<ReleaseGranularity>(["day", "week"])(
		"AC-FMT-01.5: {{funday:DD.MM}} is written as typed in a %s format, and reads back",
		(granularity) => {
			applyLocale("en", "monday", "en");
			const { written, sameNote } = roundTrip("YYYY-MM-DD {{funday:DD.MM}}", sunday(), granularity);
			expect(written).toBe("2026-04-12 {{funday:DD.MM}}");
			expect(sameNote).toBe(true);
		},
	);

	it("AC-FMT-01.5: an unknown span's letters move neither the week start nor the note's week", () => {
		// Its WW is literal text, not an ISO week, so the Sunday-start week stands.
		applyLocale("en", "sunday", "en");
		const format = "gggg-[W]ww {{monday:DD.MM}} {{funday:WW}}";
		expect(formatWithWeekTokens(format, sunday(), "week")).toBe("2026-W16 13.04 {{funday:WW}}");
		const saturday = window.moment("2026-04-18");
		expect(computeNoteDate(saturday, "week", format)).toBe(computeNoteDate(sunday(), "week", format));
		// The calendar reads the week number the filename writes: W16, not W15.
		const nested = "{{monday:gggg-[W]ww}} {{funday:W}}";
		expect(formatWithWeekTokens(nested, sunday(), "week")).toBe("2026-W16 {{funday:W}}");
		expect(getWeekNumber(sunday(), nested)).toBe(16);
	});

	it("AC-FMT-01.6: {{funday:DD.MM}} adds one warning naming funday, and the \":\" error still blocks the save", () => {
		const { errors, warnings } = validateFormat("gggg-[W]ww {{funday:DD.MM}}", "week", window.moment("2026-09-24"));
		expect(warnings.filter((warning) => warning.includes("funday"))).toHaveLength(1);
		expect(errors).toEqual([expect.stringContaining('":" cannot appear in a filename')]);
	});

	it("AC-FMT-01.6: a real weekday name raises no unrecognised-token warning", () => {
		const { warnings } = validateFormat("gggg-[W]ww {{Monday:DD}}", "week", window.moment("2026-09-24"));
		expect(warnings).toEqual([]);
	});

	describe("AC-FMT-01.4 through the production callers", () => {
		const daily = config({ format: "YYYY-MM-DD {{monday:DD.MM}}" });
		const literalPath = "Daily/2026-04-12 {{monday:DD.MM}}.md";

		it("a daily command writes the weekday token as literal text", async () => {
			applyLocale("en", "monday", "en");
			const p = ports();
			await openOrCreatePeriodNote("day", sunday(), daily, null, p);
			expect(p.vault.getFile(literalPath)).not.toBeNull();
		});

		it("the daily startup note is written under the same literal name", async () => {
			applyLocale("en", "monday", "en");
			const p = ports();
			const off = config({ enabled: false });
			await startUp({ day: { ...daily, openAtStartup: true }, week: off, month: off, year: off }, sunday(), p);
			expect(p.vault.getFile(literalPath)).not.toBeNull();
		});

		it("a click on the day cell creates the note under the literal name", async () => {
			applyLocale("en", "monday", "en");
			const p = ports();
			const event = { metaKey: false, ctrlKey: false } as MouseEvent;
			await openOrCreateNote({
				date: sunday(),
				granularity: "day",
				config: daily,
				confirmBeforeCreate: false,
				event,
				ports: p,
				confirmCreate: async () => true,
			});
			expect(p.vault.getFile(literalPath)).not.toBeNull();
		});

		it("the day dot looks the note up under the literal name", () => {
			applyLocale("en", "monday", "en");
			const p = ports();
			p.vault.seedFile(literalPath, "");
			expect([...new DotScanner(p, () => undefined).getDayNotePaths(sunday(), daily)]).toEqual([literalPath]);
		});

		// The subfolder case reaches only the basename retry, the nested format only the first parse.
		it.each([
			["the configured folder", "YYYY-MM-DD {{monday:DD.MM}}", literalPath],
			["a subfolder", "YYYY-MM-DD {{monday:DD.MM}}", "Daily/2026/2026-04-12 {{monday:DD.MM}}.md"],
			["a nested format", "YYYY/YYYY-MM-DD {{monday:DD.MM}}", "Daily/2026/2026-04-12 {{monday:DD.MM}}.md"],
		])("that literal name, in %s, resolves as the day's daily note", (_where, format, path) => {
			applyLocale("en", "monday", "en");
			const identity = resolveFileDate(path, { day: config({ format }) }, new FakeVaultConfigPort());
			expect(identity?.granularity).toBe("day");
			expect(identity?.date.format("YYYY-MM-DD")).toBe("2026-04-12");
		});
	});

	it("AC-FMT-01.1: {{date+7d}} in a weekly template names the next week's Monday", () => {
		applyLocale("en", "monday", "en");
		const weekly = config({ format: "gggg-[W]ww {{monday:DD.MM}}" });
		expect(substituteTemplateTokens("{{date+7d}}", window.moment("2026-04-13"), "week", weekly, "t")).toBe(
			"2026-W17 20.04",
		);
	});

	it("AC-FMT-01.5: a span inside a [literal] is written as typed, without escapes, and reads back", () => {
		applyLocale("en", "monday", "en");
		const { written, sameNote } = roundTrip("YYYY-MM-DD [{{funday:DD}}]", sunday(), "day");
		expect(written).toBe("2026-04-12 {{funday:DD}}");
		expect(sameNote).toBe(true);
	});

	it("AC-FMT-01.5: an escaped \\[ opens no [literal], so the span after it is still written as typed", () => {
		applyLocale("en", "monday", "en");
		const { written, sameNote } = roundTrip("YYYY-MM-DD \\[{{funday:DD}}\\]", sunday(), "day");
		expect(written).toBe("2026-04-12 [{{funday:DD}}]");
		expect(sameNote).toBe(true);
	});

	it("computeNotePath left without a granularity writes the path it wrote before US-FMT-01", () => {
		applyLocale("en", "monday", "en");
		const vaultConfig = new FakeVaultConfigPort();
		expect(computeNotePath(sunday(), config({}), vaultConfig)).toBe("Daily/2026-04-12.md");
		const weekly = config({ format: "gggg-[W]ww, {{monday:DD.MM}}", folder: "" });
		expect(computeNotePath(sunday(), weekly, vaultConfig)).toBe("2026-W15, 06.04.md");
	});
});
