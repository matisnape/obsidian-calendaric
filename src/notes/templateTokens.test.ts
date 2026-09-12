import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import moment from "moment";
import { substituteTemplateTokens } from "./templateTokens";
import { createNote } from "./noteCreate";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import type { PeriodicConfig } from "../types";

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

const DAILY_DATE = moment("2026-04-13T14:30:00");

describe("substituteTemplateTokens — universal", () => {
	it("AC-TPL-01.1: substitutes {{date}} with the note's own date", () => {
		const result = substituteTemplateTokens("{{date}}", DAILY_DATE, "day", makeConfig(), "2026-04-13");
		expect(result).toBe("2026-04-13");
	});

	it("AC-TPL-01.1: renders {{date}} in the granularity's configured format, not a fixed default", () => {
		// The default format is YYYY-MM-DD, so a configured format that differs from it
		// is the only thing that separates "reads the config" from "hardcodes a default".
		const config = makeConfig({ format: "DD.MM.YYYY" });
		const result = substituteTemplateTokens("{{date}}", DAILY_DATE, "day", config, "t");
		expect(result).toBe("13.04.2026");
	});

	it("AC-TPL-01.2: substitutes {{date:custom}} with override format", () => {
		const result = substituteTemplateTokens("{{date:DD MMMM YYYY}}", DAILY_DATE, "day", makeConfig(), "2026-04-13");
		expect(result).toBe("13 April 2026");
	});

	it("AC-TPL-01.2: substitutes a plain {{date}} that follows a {{date:FORMAT}} token", () => {
		const result = substituteTemplateTokens("{{date:DD.MM}} / {{date}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("13.04 / 2026-04-13");
	});

	it("AC-TPL-01.2: substitutes a plain {{date}} that precedes a {{date:FORMAT}} token", () => {
		// The custom-format pass runs first. A greedier pattern would swallow the text
		// from the plain {{date}} up to the custom token's closing braces.
		const result = substituteTemplateTokens("{{date}} / {{date:DD.MM}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("2026-04-13 / 13.04");
	});

	it("AC-TPL-01.4: substitutes {{title}} with the title it was given", () => {
		const result = substituteTemplateTokens("{{title}}", DAILY_DATE, "day", makeConfig(), "My Note Title");
		expect(result).toBe("My Note Title");
	});

	it("does not substitute {{date:custom}} as {{date}}", () => {
		// {{date:custom}} must be consumed before {{date}} to avoid leaving `:custom}}`
		const result = substituteTemplateTokens("{{date:DD.MM}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("13.04");
	});
});

describe("substituteTemplateTokens — {{time}}", () => {
	// The note's own date is 14:30. Every assertion below would read 14:30 if
	// {{time}} were taken from it instead of from the clock.
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-13T09:07:00"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("AC-TPL-01.3: replaces {{time}} with the wall-clock time at creation, as HH:mm", () => {
		const result = substituteTemplateTokens("{{time}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("09:07");
	});

	it("AC-TPL-01.3: does not derive {{time}} from the time-of-day the note's date carries", () => {
		const result = substituteTemplateTokens("{{time}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).not.toBe("14:30");
	});

	it("AC-TPL-01.3: writes the clock time even when the note's date carries midnight", () => {
		// A date clicked in the calendar has no time-of-day. Reading {{time}} off it
		// would stamp 00:00 into every note the user did not create for right now.
		const midnight = moment("2026-04-13");
		const result = substituteTemplateTokens("{{time}}", midnight, "day", makeConfig(), "t");
		expect(result).toBe("09:07");
	});
});

describe("substituteTemplateTokens — date arithmetic", () => {
	it("AC-TPL-01.5: shifts the note's date forward for {{date+7d:FORMAT}}", () => {
		const result = substituteTemplateTokens("{{date+7d:YYYY-MM-DD}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("2026-04-20");
	});

	it("AC-TPL-01.5: shifts the note's date backward for {{date-1M:FORMAT}}", () => {
		const result = substituteTemplateTokens("{{date-1M:YYYY-MM-DD}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("2026-03-13");
	});

	it("AC-TPL-01.5: renders the shifted date in FORMAT when one is given", () => {
		const result = substituteTemplateTokens("{{date+1d:DD MMMM YYYY}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("14 April 2026");
	});

	it("AC-TPL-01.5: renders the shifted date in the configured format when no FORMAT is given", () => {
		const config = makeConfig({ format: "DD.MM.YYYY" });
		const result = substituteTemplateTokens("{{date+1d}}|{{date-1d}}", DAILY_DATE, "day", config, "t");
		expect(result).toBe("14.04.2026|12.04.2026");
	});

	it("AC-TPL-01.5: accepts week, month, quarter and year units", () => {
		const template = "{{date+1w:YYYY-MM-DD}}|{{date+1M:YYYY-MM-DD}}|{{date+1Q:YYYY-MM-DD}}|{{date+1y:YYYY-MM-DD}}";
		const result = substituteTemplateTokens(template, DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("2026-04-20|2026-05-13|2026-07-13|2027-04-13");
	});

	it("AC-TPL-01.5: crosses month and year boundaries", () => {
		const newYear = moment("2026-01-01T09:00:00");
		const result = substituteTemplateTokens("{{date-1d:YYYY-MM-DD}}|{{date+1M:YYYY-MM-DD}}", newYear, "day", makeConfig(), "t");
		expect(result).toBe("2025-12-31|2026-02-01");
	});

	it("AC-TPL-01.5: resolves week tokens in the configured format, as the filename writer does", () => {
		// computeNotePath() names files with formatWithWeekTokens(). An offset token
		// rendered with plain format() would leave `{{monday:DD.MM}}` in the note.
		//
		// The offset carries the week anchor with it: +7d lands in the following
		// week, so the Monday is that week's (20.04), not the note's own (13.04).
		// This is the string computeNotePath() writes for 2026-04-20.
		const config = makeConfig({ format: "{{monday:DD.MM}}-YYYY-MM-DD" });
		const result = substituteTemplateTokens("{{date+7d}}", DAILY_DATE, "day", config, "t");
		expect(result).toBe("20.04-2026-04-20");
	});

	it("AC-TPL-01.5: substitutes offset tokens for weekly granularity too", () => {
		const config = makeConfig({ format: "gggg-[W]ww" });
		const result = substituteTemplateTokens("{{date+1w}}", moment("2026-04-13"), "week", config, "t");
		expect(result).toBe("2026-W17");
	});

	it("does not mutate the date it was given", () => {
		// Both offsets are computed eagerly, so a missing clone() adds seven days and
		// takes them straight back off. clone() returns a different object, so a
		// correct implementation never calls add() on `date` itself.
		const date = moment("2026-04-13T14:30:00");
		const add = vi.spyOn(date, "add");

		substituteTemplateTokens("{{date+7d:YYYY-MM-DD}}|{{date-7d:YYYY-MM-DD}}", date, "day", makeConfig(), "t");

		expect(add).not.toHaveBeenCalled();
		expect(date.format("YYYY-MM-DD")).toBe("2026-04-13");
	});

	it("AC-TPL-01.6: leaves {{date+7:FORMAT}} exactly as written when the unit letter is missing", () => {
		const result = substituteTemplateTokens("{{date+7:YYYY-MM-DD}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("{{date+7:YYYY-MM-DD}}");
	});

	it("AC-TPL-01.6: leaves a malformed offset with no FORMAT exactly as written", () => {
		const result = substituteTemplateTokens("{{date-3}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("{{date-3}}");
	});

	it("AC-TPL-01.6: keeps a malformed offset while the tokens around it are still substituted", () => {
		// The criterion is that nothing is deleted and nothing is raised. A body that
		// carries one bad token still gets every good one filled in.
		const template = "{{date}} {{date+7:DD.MM}} {{date+7d:DD.MM}}";
		const result = substituteTemplateTokens(template, DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("2026-04-13 {{date+7:DD.MM}} 20.04");
	});
});

describe("substituteTemplateTokens — daily", () => {
	it("AC-TPL-02.1: substitutes {{yesterday}}", () => {
		const result = substituteTemplateTokens("{{yesterday}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("2026-04-12");
	});

	it("AC-TPL-02.2: substitutes {{tomorrow}}", () => {
		const result = substituteTemplateTokens("{{tomorrow}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("2026-04-14");
	});

	it("AC-TPL-02.1, AC-TPL-02.2: formats {{yesterday}} and {{tomorrow}} with the configured daily format", () => {
		const config = makeConfig({ format: "DD.MM.YYYY" });
		const result = substituteTemplateTokens("{{yesterday}}|{{tomorrow}}", DAILY_DATE, "day", config, "t");
		expect(result).toBe("12.04.2026|14.04.2026");
	});

	it("crosses month and year boundaries", () => {
		const newYear = moment("2026-01-01T09:00:00");
		const result = substituteTemplateTokens("{{yesterday}}|{{tomorrow}}", newYear, "day", makeConfig(), "t");
		expect(result).toBe("2025-12-31|2026-01-02");
	});

	it("resolves week tokens in the daily format, so the value matches the adjacent note's filename", () => {
		// computeNotePath() names files with formatWithWeekTokens(). {{yesterday}} has to
		// render the same string, or the link it produces points at a file that does not exist.
		const config = makeConfig({ format: "{{monday:DD.MM}}-YYYY-MM-DD" });
		const result = substituteTemplateTokens("{{yesterday}}|{{tomorrow}}", DAILY_DATE, "day", config, "t");
		expect(result).toBe("06.04-2026-04-12|13.04-2026-04-14");
	});

	it("does not mutate the date it was given", () => {
		// Asserting the final state is not enough: both values are computed eagerly, so a
		// missing clone() subtracts a day and adds it straight back. clone() returns a
		// different object, so a correct implementation never calls these two on `date`.
		const date = moment("2026-04-13T14:30:00");
		const subtract = vi.spyOn(date, "subtract");
		const add = vi.spyOn(date, "add");

		substituteTemplateTokens("{{yesterday}}|{{tomorrow}}", date, "day", makeConfig(), "t");

		expect(subtract).not.toHaveBeenCalled();
		expect(add).not.toHaveBeenCalled();
		expect(date.format("YYYY-MM-DD")).toBe("2026-04-13");
	});

	it("AC-TPL-02.3: does not substitute {{yesterday}} for weekly granularity", () => {
		const result = substituteTemplateTokens("{{yesterday}}", DAILY_DATE, "week", makeConfig(), "t");
		expect(result).toBe("{{yesterday}}");
	});

	it("AC-TPL-02.3: does not substitute {{tomorrow}} for weekly granularity", () => {
		const result = substituteTemplateTokens("{{tomorrow}}", DAILY_DATE, "week", makeConfig(), "t");
		expect(result).toBe("{{tomorrow}}");
	});

	it("AC-TPL-02.3: leaves both adjacent-day tokens intact in a weekly template", () => {
		const template = "# Week {{monday:DD.MM}}\n{{yesterday}} / {{tomorrow}}";
		const config = makeConfig({ format: "gggg-[W]ww" });
		const result = substituteTemplateTokens(template, moment("2026-04-13"), "week", config, "t");
		expect(result).toBe("# Week 13.04\n{{yesterday}} / {{tomorrow}}");
	});
});

describe("substituteTemplateTokens — weekly", () => {
	// MONDAY = Apr 13, 2026 (ISO week 16)
	const WEEKLY_DATE = moment("2026-04-13");
	const weeklyConfig = makeConfig({ format: "gggg-[W]ww" });

	it("substitutes {{monday:DD.MM}}", () => {
		const result = substituteTemplateTokens("{{monday:DD.MM}}", WEEKLY_DATE, "week", weeklyConfig, "t");
		expect(result).toBe("13.04");
	});

	it("substitutes {{sunday:DD.MM}}", () => {
		const result = substituteTemplateTokens("{{sunday:DD.MM}}", WEEKLY_DATE, "week", weeklyConfig, "t");
		expect(result).toBe("19.04");
	});

	it("substitutes full weekly template", () => {
		const template = "# Week {{monday:DD.MM}} – {{sunday:DD.MM}}\n### Monday {{monday:DD.MM}}";
		const result = substituteTemplateTokens(template, WEEKLY_DATE, "week", weeklyConfig, "t");
		expect(result).toBe("# Week 13.04 – 19.04\n### Monday 13.04");
	});

	it("does not substitute {{monday:fmt}} for daily granularity", () => {
		const result = substituteTemplateTokens("{{monday:DD.MM}}", WEEKLY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("{{monday:DD.MM}}");
	});

	it("{{date}} uses weekly format with week tokens for weekly notes", () => {
		const config = makeConfig({ format: "gggg-[W]ww, {{monday:DD.MM}} – {{sunday:DD.MM}}" });
		const result = substituteTemplateTokens("{{date}}", WEEKLY_DATE, "week", config, "t");
		expect(result).toBe("2026-W16, 13.04 – 19.04");
	});
});

describe("substituteTemplateTokens — leaves what it does not recognise (US-TPL-06)", () => {
	// Every test here pairs the unrecognised text with a token that IS recognised,
	// or picks text a loosened pattern would eat. A "leave it alone" assertion on
	// its own still passes when substitution does nothing at all, which is the one
	// failure these tests exist to catch.

	it("AC-TPL-06.1: replaces only the recognised token and leaves a different template engine's syntax untouched", () => {
		// <%* ... %> is Templater's own scripting syntax, not this plugin's. Only
		// the {{date}} token belongs to us; everything else must survive verbatim,
		// including the whitespace and punctuation around it.
		const template = "{{date}} <%* tp.file.rename(tp.file.title) %>";
		const result = substituteTemplateTokens(template, DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("2026-04-13 <%* tp.file.rename(tp.file.title) %>");
	});

	it("AC-TPL-06.1: leaves another engine's syntax alone even when it carries braces of its own", () => {
		// Templater scripting is JavaScript, so a block of it contains { } pairs.
		// A pattern that reached for the next closing brace rather than for '}}'
		// would cut this block open.
		const template = "<% if (tp.date.now()) { %>a{{date}}b<% } %>";
		const result = substituteTemplateTokens(template, DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("<% if (tp.date.now()) { %>a2026-04-13b<% } %>");
	});

	it("AC-TPL-06.1, AC-TPL-06.2: substitutes a recognised token immediately next to an unrecognised, similarly-shaped one", () => {
		// {{dateTime}} is not a token this plugin knows — it only resembles {{date}}
		// by sharing a prefix. Sitting right next to a real {{date}} is the case a
		// prefix-based or non-anchored match would get wrong.
		const template = "{{date}} {{dateTime}}";
		const result = substituteTemplateTokens(template, DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("2026-04-13 {{dateTime}}");
	});

	it("AC-TPL-06.2: leaves an unrecognised {{...}} token exactly as written, never as an empty string", () => {
		const result = substituteTemplateTokens("{{fooBar}}|{{date}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("{{fooBar}}|2026-04-13");
		expect(result).toContain("{{fooBar}}");
	});

	it("AC-TPL-06.2: leaves a token name that differs from a recognised one only by case or spacing", () => {
		// Every name here is one edit away from {{date}}. A case-insensitive or
		// whitespace-tolerant match would claim all four.
		const template = "{{DATE}} {{ date }} {{date }} {{ date}} {{date}}";
		const result = substituteTemplateTokens(template, DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("{{DATE}} {{ date }} {{date }} {{ date}} 2026-04-13");
	});

	it("AC-TPL-06.2: leaves an unrecognised token untouched even where it reads as markdown code", () => {
		// The substitution runs over the raw string with no awareness of markdown
		// structure, so a code span or fence carries no special protection — and
		// needs none, because an unrecognised token is left alone everywhere. The
		// {{date}} outside the fence is what shows substitution ran at all.
		const template = "{{date}}\nUse `{{templaterDate}}` inside a fence:\n```\n{{templaterDate}}\n```";
		const result = substituteTemplateTokens(template, DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("2026-04-13\nUse `{{templaterDate}}` inside a fence:\n```\n{{templaterDate}}\n```");
	});

	it("AC-TPL-06.2: keeps the surplus braces of a doubled delimiter around the token it recognises inside them", () => {
		// {{{date}}} carries a recognised {{date}} inside a brace this plugin has no
		// meaning for. The token is substituted and the surplus brace stays — the
		// criterion forbids deleting it, not reading the token it wraps.
		const result = substituteTemplateTokens("{{{date}}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("{2026-04-13}");
	});

	it("AC-TPL-06.3: leaves a template with no recognised tokens unchanged, byte for byte", () => {
		// Every line is something a loosened pattern would claim: a token-shaped
		// name, another engine's syntax, a stray opening delimiter. The leading and
		// trailing newlines are part of "byte for byte" — a comparison against
		// trimmed content would not see either one change.
		const template = "\n# Notes\n{{fooBar}} <%* tp.file.title %>\n{{ date }} and a stray {{date\nplain line\n";
		const result = substituteTemplateTokens(template, DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe(template);
	});

	it("AC-TPL-06.5: leaves a stray, never-closed '{{date' delimiter exactly as written", () => {
		const template = "prefix {{date suffix {{date}}";
		const result = substituteTemplateTokens(template, DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("prefix {{date suffix 2026-04-13");
	});

	it("AC-TPL-06.5: does not let an unclosed '{{date:' reach past itself for the next token's closing braces", () => {
		// '{{date:DD ' has no '}}' of its own. The next '}}' in the body belongs to a
		// different token, so a format group that may cross '{' pairs the two halves
		// up, formats the text between them as a moment pattern, and destroys both.
		const template = "{{date:DD {{date:MM}}";
		const result = substituteTemplateTokens(template, DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("{{date:DD 04");
	});

	it("AC-TPL-06.5: does not let an unclosed offset token reach past itself for the next token's closing braces", () => {
		// The same hole in the offset pattern's optional format group.
		const template = "{{date+1d:DD {{date:MM}}";
		const result = substituteTemplateTokens(template, DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("{{date+1d:DD 04");
	});
});

describe("createNote — the file's first content is already substituted (US-TPL-06)", () => {
	// These two live beside the substitution they are about rather than in
	// noteCreate.test.ts, because what they pin is the token system's contract
	// with a second template engine: the note reaches the vault substituted or it
	// does not reach it at all.
	const noWarn = () => undefined;

	it("AC-TPL-06.4: writes the fully substituted content, so an external engine's first look is never the raw template", async () => {
		// Templater and the core Templates plugin both act on a file the moment it
		// is created. Whatever they read is whatever createFile was handed, so that
		// one argument is the whole of this criterion.
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{date}}\n{{title}} <%* tp.file.title %>\n{{fooBar}}");
		const createFile = vi.spyOn(vault, "createFile");

		await createNote(
			"journal/2026-04-13.md",
			DAILY_DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily.md" }),
			vault,
			noWarn,
		);

		expect(createFile).toHaveBeenCalledWith(
			"journal/2026-04-13.md",
			"# 2026-04-13\n2026-04-13 <%* tp.file.title %>\n{{fooBar}}",
		);
	});

	it("AC-TPL-06.4: writes the note's content once, never a pre-substitution version followed by a substituted one", async () => {
		// A second write would be a second create event, and the engine would have
		// already run against the first one.
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{date}}");
		const createFile = vi.spyOn(vault, "createFile");

		await createNote(
			"journal/2026-04-13.md",
			DAILY_DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily.md" }),
			vault,
			noWarn,
		);

		expect(createFile).toHaveBeenCalledTimes(1);
		expect(createFile).toHaveBeenNthCalledWith(1, "journal/2026-04-13.md", "# 2026-04-13");
	});
});
