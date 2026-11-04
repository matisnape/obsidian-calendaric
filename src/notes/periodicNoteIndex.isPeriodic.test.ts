import { describe, it, expect } from "vitest";
import { PeriodicNoteIndex } from "./periodicNoteIndex";
import type { PeriodicConfigs } from "./periodicNoteIndex";
import { DEFAULT_PERIODIC_CONFIG } from "../types";
import type { PeriodicConfig } from "../types";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";

function config(format: string, folder: string): PeriodicConfig {
	return { ...DEFAULT_PERIODIC_CONFIG, enabled: true, format, folder };
}

const CONFIGS: PeriodicConfigs = {
	day: config("YYYY-MM-DD", "Daily"),
	week: config("GGGG-[W]WW", "Weekly"),
	month: config("YYYY-MM", "Monthly"),
	year: config("YYYY", "Yearly"),
};

const NO_DEFAULT_FOLDER = new FakeVaultConfigPort("");

/** A vault holding exactly these paths, each with empty content. */
function vaultWith(...paths: string[]): FakeVaultPort {
	const vault = new FakeVaultPort();
	for (const path of paths) vault.seedFile(path, "");
	return vault;
}

function indexOver(vault: FakeVaultPort, configs: PeriodicConfigs = CONFIGS): PeriodicNoteIndex {
	return new PeriodicNoteIndex(vault, NO_DEFAULT_FOLDER, configs);
}

function create(vault: FakeVaultPort, path: string): void {
	vault.seedFile(path, "");
	vault.emitChange({ kind: "create", file: { path } });
}

function rename(vault: FakeVaultPort, from: string, to: string): void {
	vault.renameFile(from, to);
	vault.emitChange({ kind: "rename", file: { path: to }, oldPath: from });
}

/** The period a path is recognised as, in a form one assertion can compare. */
function recognised(index: PeriodicNoteIndex, path: string): { granularity: string; date: string } | null {
	const granularity = index.granularityOf(path);
	const date = index.dateOf(path);
	if (granularity === null && date === null) return null;
	return { granularity: String(granularity), date: date?.format("YYYY-MM-DD") ?? "null" };
}

describe("PeriodicNoteIndex — AC-NOTE-08.1 a file in a configured folder, in its format", () => {
	it.each([
		["Daily/2026-04-15.md", "day", "2026-04-15"],
		["Weekly/2026-W16.md", "week", "2026-04-13"],
		["Monthly/2026-04.md", "month", "2026-04-01"],
		["Yearly/2026.md", "year", "2026-01-01"],
	])("AC-NOTE-08.1: recognises %s as a %s note for the period starting %s", (path, granularity, date) => {
		const index = indexOver(vaultWith(path));

		expect(recognised(index, path)).toEqual({ granularity, date });
	});

	it("AC-NOTE-08.1: recognises a note created after the index was built, with its exact period", () => {
		const vault = vaultWith();
		const index = indexOver(vault);

		create(vault, "Daily/2026-04-15.md");

		expect(recognised(index, "Daily/2026-04-15.md")).toEqual({ granularity: "day", date: "2026-04-15" });
	});
});

describe("PeriodicNoteIndex — AC-NOTE-08.2 a date-like name outside every configured folder", () => {
	// "DailyArchive" shares the daily folder's name as a prefix: only the
	// trailing "/" in the folder check keeps it outside.
	it.each(["2026-04-15.md", "Notes/2026-04-15.md", "Notes/2026-W16.md", "DailyArchive/2026-04-15.md"])(
		"AC-NOTE-08.2: does not recognise %s",
		(path) => {
			const index = indexOver(vaultWith(path));

			expect(recognised(index, path)).toBeNull();
		},
	);

	it("AC-NOTE-08.2: does not recognise a date-like file created outside every configured folder", () => {
		const vault = vaultWith();
		const index = indexOver(vault);

		create(vault, "Notes/2026-04-15.md");

		expect(recognised(index, "Notes/2026-04-15.md")).toBeNull();
	});
});

describe("PeriodicNoteIndex — AC-NOTE-08.3 a file that is not markdown", () => {
	const NON_MARKDOWN = ["Daily/2026-04-15.png", "Daily/2026-04-15.pdf", "Daily/2026-04-15.canvas"];

	it.each(NON_MARKDOWN)("AC-NOTE-08.3: does not recognise %s when it is created in the daily folder", (path) => {
		const vault = vaultWith();
		const index = indexOver(vault);

		create(vault, path);

		expect(recognised(index, path)).toBeNull();
	});

	it.each(NON_MARKDOWN)("AC-NOTE-08.3: does not recognise %s when it is renamed inside the daily folder", (path) => {
		const vault = vaultWith("Daily/attachment.bin");
		const index = indexOver(vault);

		rename(vault, "Daily/attachment.bin", path);

		expect(recognised(index, path)).toBeNull();
	});

	// The prefix-match opt-in is what the vault's weekly notes run under, so a
	// non-markdown attachment named after a period must stay out there too.
	const PREFIX_CONFIGS: PeriodicConfigs = {
		day: { ...config("YYYY-MM-DD", "Daily"), allowPrefixMatch: true },
		week: { ...config("GGGG-[W]WW", "Weekly"), allowPrefixMatch: true },
	};

	it.each(["Daily/2026-04-15.png", "Weekly/2026-W16.png"])(
		"AC-NOTE-08.3: does not recognise %s created under a prefix-match format",
		(path) => {
			const vault = vaultWith();
			const index = indexOver(vault, PREFIX_CONFIGS);

			create(vault, path);

			expect(recognised(index, path)).toBeNull();
		},
	);

	it.each(["Daily/2026-04-15.pdf", "Weekly/2026-W16.pdf"])(
		"AC-NOTE-08.3: does not recognise %s renamed inside its folder under a prefix-match format",
		(path) => {
			const from = `${path.slice(0, path.indexOf("/"))}/attachment.bin`;
			const vault = vaultWith(from);
			const index = indexOver(vault, PREFIX_CONFIGS);

			rename(vault, from, path);

			expect(recognised(index, path)).toBeNull();
		},
	);

	it.each([
		["an exact", CONFIGS],
		["a prefix-match", PREFIX_CONFIGS],
	])("AC-NOTE-08.3: drops a note renamed from .md to .png under %s format", (_kind, configs) => {
		const vault = vaultWith("Daily/2026-04-15.md");
		const index = indexOver(vault, configs);
		expect(recognised(index, "Daily/2026-04-15.md")).toEqual({ granularity: "day", date: "2026-04-15" });

		rename(vault, "Daily/2026-04-15.md", "Daily/2026-04-15.png");

		expect(recognised(index, "Daily/2026-04-15.png")).toBeNull();
		expect(recognised(index, "Daily/2026-04-15.md")).toBeNull();
		expect(index.get("day", window.moment("2026-04-15"))).toBeNull();
	});
});

describe("PeriodicNoteIndex — AC-NOTE-08.4 a rename that keeps the period", () => {
	it("AC-NOTE-08.4: still recognises a daily note moved into a subfolder as the same day", () => {
		const vault = vaultWith("Daily/2026-04-15.md");
		const index = indexOver(vault);
		expect(recognised(index, "Daily/2026-04-15.md")).toEqual({ granularity: "day", date: "2026-04-15" });

		rename(vault, "Daily/2026-04-15.md", "Daily/2026/2026-04-15.md");

		expect(recognised(index, "Daily/2026/2026-04-15.md")).toEqual({ granularity: "day", date: "2026-04-15" });
		expect(recognised(index, "Daily/2026-04-15.md")).toBeNull();
	});

	it("AC-NOTE-08.4: still recognises a weekly note renamed to a longer title as the same week", () => {
		const configs: PeriodicConfigs = { week: { ...config("GGGG-[W]WW", "Weekly"), allowPrefixMatch: true } };
		const vault = vaultWith("Weekly/2026-W16.md");
		const index = indexOver(vault, configs);

		rename(vault, "Weekly/2026-W16.md", "Weekly/2026-W16, 13.04 - 19.04.md");

		expect(recognised(index, "Weekly/2026-W16, 13.04 - 19.04.md")).toEqual({
			granularity: "week",
			date: "2026-04-13",
		});
		expect(recognised(index, "Weekly/2026-W16.md")).toBeNull();
	});
});
