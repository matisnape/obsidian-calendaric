import { describe, it, expect } from "vitest";
import { listPeriodicNotes } from "./listPeriodicNotes";
import type { FileConfigs } from "../fmt/resolveFileDate";
import { DEFAULT_PERIODIC_CONFIG } from "../types";
import type { PeriodicConfig } from "../types";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";

function config(format: string, folder: string): PeriodicConfig {
	return { ...DEFAULT_PERIODIC_CONFIG, enabled: true, format, folder };
}

const CONFIGS: FileConfigs = {
	day: config("YYYY-MM-DD", "Daily"),
	week: config("GGGG-[W]WW", "Weekly"),
};

const NO_DEFAULT_FOLDER = new FakeVaultConfigPort("");

function vaultWith(folders: string[], paths: string[]): FakeVaultPort {
	const vault = new FakeVaultPort();
	for (const folder of folders) vault.seedFolder(folder);
	for (const path of paths) vault.seedFile(path, "");
	return vault;
}

function listedPaths(
	vault: FakeVaultPort,
	granularity: "day" | "week",
	configs: FileConfigs = CONFIGS,
	vaultConfig = NO_DEFAULT_FOLDER,
): string[] {
	return listPeriodicNotes(granularity, configs, vault, vaultConfig)
		.map((file) => file.path)
		.sort();
}

describe("listPeriodicNotes", () => {
	it("AC-NOTE-02.1: returns every note of the granularity, the ones nested in subfolders included", () => {
		const vault = vaultWith(
			["Daily/2026/11", "Daily/archive", "Weekly"],
			[
				"Daily/2026-11-03.md",
				"Daily/2026/11/2026-11-04.md",
				"Daily/archive/2025-01-01.md",
				"Weekly/2026-W45.md",
			],
		);

		expect(listedPaths(vault, "day")).toEqual([
			"Daily/2026-11-03.md",
			"Daily/2026/11/2026-11-04.md",
			"Daily/archive/2025-01-01.md",
		]);
	});

	it("AC-NOTE-02.1: two files naming the same day both come back", () => {
		const vault = vaultWith(["Daily/archive"], ["Daily/2026-11-04.md", "Daily/archive/2026-11-04.md"]);

		expect(listedPaths(vault, "day")).toEqual(["Daily/2026-11-04.md", "Daily/archive/2026-11-04.md"]);
	});

	it("AC-NOTE-02.2: a configured folder that does not exist is an error naming that folder", () => {
		const vault = vaultWith(["Weekly"], ["Weekly/2026-W45.md"]);

		expect(() => listPeriodicNotes("day", CONFIGS, vault, NO_DEFAULT_FOLDER)).toThrow(/"Daily"/);
	});

	it("AC-NOTE-02.2: an empty folder setting that falls back to a missing default folder names the default", () => {
		const vault = vaultWith([], []);
		const configs: FileConfigs = { day: config("YYYY-MM-DD", "") };

		expect(() => listPeriodicNotes("day", configs, vault, new FakeVaultConfigPort("Inbox"))).toThrow(/"Inbox"/);
	});

	it("AC-NOTE-02.2: the vault root always exists, whether written as an empty folder or as /", () => {
		// No folder is seeded: the root is never one the port is asked about.
		const vault = vaultWith([], ["2026-11-04.md"]);

		expect(listedPaths(vault, "day", { day: config("YYYY-MM-DD", "") })).toEqual(["2026-11-04.md"]);
		expect(listedPaths(vault, "day", { day: config("YYYY-MM-DD", "/") })).toEqual(["2026-11-04.md"]);
	});

	it("AC-NOTE-02.3: an existing but empty folder gives an empty list, not an error", () => {
		const vault = vaultWith(["Daily", "Weekly"], ["Weekly/2026-W45.md"]);

		expect(listedPaths(vault, "day")).toEqual([]);
	});

	it("AC-NOTE-02.4: a markdown file in the folder whose name does not match the format is left out", () => {
		const vault = vaultWith(["Daily/projects"], [
			"Daily/2026-11-04.md",
			"Daily/meeting notes.md",
			"Daily/projects/2026-11.md",
		]);

		expect(listedPaths(vault, "day")).toEqual(["Daily/2026-11-04.md"]);
	});

	it("a granularity that is switched off gives an empty list", () => {
		const vault = vaultWith(["Daily"], ["Daily/2026-11-04.md"]);

		expect(listPeriodicNotes("month", CONFIGS, vault, NO_DEFAULT_FOLDER)).toEqual([]);
	});
});
