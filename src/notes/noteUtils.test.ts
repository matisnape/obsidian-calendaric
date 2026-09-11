import { describe, it, expect } from "vitest";
import moment from "moment";
import { applyWeekTokens, formatWithWeekTokens, computeNotePath } from "./noteUtils";
import type { PeriodicConfig } from "../types";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";

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

// Apr 13, 2026 is Monday of ISO week 16
// isoWeekday(1)=Apr 13, isoWeekday(7)=Apr 19
const MONDAY = moment("2026-04-13"); // Monday, ISO week 16

describe("applyWeekTokens", () => {
	it("substitutes {{monday:DD.MM}}", () => {
		// MONDAY = Apr 13 (Mon W16), isoWeekday(1) = Apr 13
		expect(applyWeekTokens("{{monday:DD.MM}}", MONDAY)).toBe("13.04");
	});

	it("substitutes {{sunday:DD.MM}}", () => {
		// isoWeekday(7) = Apr 19
		expect(applyWeekTokens("{{sunday:DD.MM}}", MONDAY)).toBe("19.04");
	});

	it("substitutes after moment.format() output (no week tokens remain)", () => {
		const afterMoment = "2026-W16, {{monday:DD.MM}} – {{sunday:DD.MM}}";
		expect(applyWeekTokens(afterMoment, MONDAY)).toBe("2026-W16, 13.04 – 19.04");
	});

	it("handles wednesday with YYYY-MM-DD format", () => {
		// Wed of week Apr 13–19 = Apr 15
		expect(applyWeekTokens("{{wednesday:YYYY-MM-DD}}", MONDAY)).toBe("2026-04-15");
	});

	it("is case-insensitive for weekday names", () => {
		expect(applyWeekTokens("{{Monday:DD.MM}}", MONDAY)).toBe("13.04");
		expect(applyWeekTokens("{{SUNDAY:DD.MM}}", MONDAY)).toBe("19.04");
	});

	it("leaves unrecognised tokens untouched", () => {
		expect(applyWeekTokens("{{date}}", MONDAY)).toBe("{{date}}");
	});

	it("is a no-op on strings without tokens", () => {
		expect(applyWeekTokens("2026-W16", MONDAY)).toBe("2026-W16");
	});
});

describe("formatWithWeekTokens", () => {
	it("produces correct filename for full week range format", () => {
		const fmt = "gggg-[W]ww, {{monday:DD.MM}} – {{sunday:DD.MM}}";
		expect(formatWithWeekTokens(fmt, MONDAY)).toBe("2026-W16, 13.04 – 19.04");
	});

	it("works for pure moment format without week tokens", () => {
		expect(formatWithWeekTokens("YYYY-MM-DD", MONDAY)).toBe("2026-04-13");
	});
});

describe("computeNotePath", () => {
	const vaultConfig = new FakeVaultConfigPort();
	const dailyDate = moment("2026-04-13");

	it("builds path with folder", () => {
		const config = makeConfig({ format: "YYYY-MM-DD", folder: "journal/daily" });
		expect(computeNotePath(dailyDate, config, vaultConfig)).toBe("journal/daily/2026-04-13.md");
	});

	it("builds path without folder (vault root)", () => {
		const config = makeConfig({ format: "YYYY-MM-DD", folder: "" });
		expect(computeNotePath(dailyDate, config, vaultConfig)).toBe("2026-04-13.md");
	});

	it("applies week tokens for weekly format", () => {
		const config = makeConfig({
			format: "gggg-[W]ww, {{monday:DD.MM}} – {{sunday:DD.MM}}",
			folder: "journal/weekly",
		});
		expect(computeNotePath(MONDAY, config, vaultConfig)).toBe("journal/weekly/2026-W16, 13.04 – 19.04.md");
	});

	it("uses Obsidian default folder when config folder is empty and newFileLocation=folder", () => {
		const configWithDefault = new FakeVaultConfigPort("Inbox");
		const config = makeConfig({ format: "YYYY-MM-DD", folder: "" });
		expect(computeNotePath(dailyDate, config, configWithDefault)).toBe("Inbox/2026-04-13.md");
	});
});
