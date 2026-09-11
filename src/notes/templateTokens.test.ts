import { describe, it, expect, vi } from "vitest";
import moment from "moment";
import { substituteTemplateTokens } from "./templateTokens";
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
	it("substitutes {{date}} using configured format", () => {
		const result = substituteTemplateTokens("{{date}}", DAILY_DATE, "day", makeConfig(), "2026-04-13");
		expect(result).toBe("2026-04-13");
	});

	it("substitutes {{date:custom}} with override format", () => {
		const result = substituteTemplateTokens("{{date:DD MMMM YYYY}}", DAILY_DATE, "day", makeConfig(), "2026-04-13");
		expect(result).toBe("13 April 2026");
	});

	it("substitutes {{time}}", () => {
		const result = substituteTemplateTokens("{{time}}", DAILY_DATE, "day", makeConfig(), "2026-04-13");
		expect(result).toBe("14:30");
	});

	it("substitutes {{title}}", () => {
		const result = substituteTemplateTokens("{{title}}", DAILY_DATE, "day", makeConfig(), "My Note Title");
		expect(result).toBe("My Note Title");
	});

	it("does not substitute {{date:custom}} as {{date}}", () => {
		// {{date:custom}} must be consumed before {{date}} to avoid leaving `:custom}}`
		const result = substituteTemplateTokens("{{date:DD.MM}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("13.04");
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
