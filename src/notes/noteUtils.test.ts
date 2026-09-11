import { describe, it, expect } from "vitest";
import moment from "moment";
import { applyWeekTokens, formatWithWeekTokens, computeNotePath, resolveNoteFolder, checkNoteFolder } from "./noteUtils";
import type { PeriodicConfig } from "../types";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeVaultPort } from "../adapters/fakeVaultPort";

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

	it("builds a vault-root path for an explicit \"/\" folder, ignoring the default folder", () => {
		const configWithDefault = new FakeVaultConfigPort("Inbox");
		const config = makeConfig({ format: "YYYY-MM-DD", folder: "/" });
		expect(computeNotePath(dailyDate, config, configWithDefault)).toBe("2026-04-13.md");
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

	it("rejects a path with an empty or dot segment", () => {
		const vault = new FakeVaultPort();

		expect(checkNoteFolder("journal//daily", new FakeVaultConfigPort(), vault).valid).toBe(false);
		expect(checkNoteFolder("journal/../daily", new FakeVaultConfigPort(), vault).valid).toBe(false);
	});
});
