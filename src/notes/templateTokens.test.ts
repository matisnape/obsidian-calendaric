import { describe, it, expect } from "vitest";
import moment from "moment";
import { substituteTemplateTokens } from "./templateTokens";
import type { PeriodicConfig } from "../types";

function makeConfig(overrides: Partial<PeriodicConfig> = {}): PeriodicConfig {
	return {
		enabled: true,
		format: "YYYY-MM-DD",
		folder: "",
		templatePath: "",
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
	it("substitutes {{yesterday}}", () => {
		const result = substituteTemplateTokens("{{yesterday}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("2026-04-12");
	});

	it("substitutes {{tomorrow}}", () => {
		const result = substituteTemplateTokens("{{tomorrow}}", DAILY_DATE, "day", makeConfig(), "t");
		expect(result).toBe("2026-04-14");
	});

	it("does not substitute {{yesterday}} for weekly granularity", () => {
		const result = substituteTemplateTokens("{{yesterday}}", DAILY_DATE, "week", makeConfig(), "t");
		expect(result).toBe("{{yesterday}}");
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
