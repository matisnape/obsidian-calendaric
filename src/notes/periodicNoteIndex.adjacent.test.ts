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
};

function vaultWith(...paths: string[]): FakeVaultPort {
	const vault = new FakeVaultPort();
	for (const path of paths) vault.seedFile(path, "");
	return vault;
}

const indexOver = (vault: FakeVaultPort) => new PeriodicNoteIndex(vault, new FakeVaultConfigPort(""), CONFIGS);

describe("AC-NOTE-09.1: the nearest existing note either side of a reference note", () => {
	it("AC-NOTE-09.1: returns the nearest later and the nearest earlier note, not merely any one", () => {
		const index = indexOver(
			vaultWith("Daily/2026-04-01.md", "Daily/2026-04-10.md", "Daily/2026-04-13.md", "Daily/2026-04-15.md", "Daily/2026-04-20.md"),
		);

		expect(index.closestTo("Daily/2026-04-13.md", "forward")?.path).toBe("Daily/2026-04-15.md");
		expect(index.closestTo("Daily/2026-04-13.md", "backward")?.path).toBe("Daily/2026-04-10.md");
	});

	it("AC-NOTE-09.1: answers only with a note of the reference note's own granularity", () => {
		const index = indexOver(
			vaultWith("Daily/2026-04-01.md", "Weekly/2026-W15.md", "Daily/2026-04-13.md", "Weekly/2026-W17.md", "Daily/2026-04-30.md"),
		);

		expect(index.closestTo("Daily/2026-04-13.md", "backward")?.path).toBe("Daily/2026-04-01.md");
		expect(index.closestTo("Daily/2026-04-13.md", "forward")?.path).toBe("Daily/2026-04-30.md");
		expect(index.closestTo("Weekly/2026-W15.md", "forward")?.path).toBe("Weekly/2026-W17.md");
	});
});

describe("AC-NOTE-09.2: nothing that way means nothing, never the note at the other end", () => {
	it("AC-NOTE-09.2: returns nothing forward from the latest note and backward from the earliest", () => {
		const index = indexOver(vaultWith("Daily/2026-04-10.md", "Daily/2026-04-13.md", "Daily/2026-04-20.md"));

		expect(() => index.closestTo("Daily/2026-04-20.md", "forward")).not.toThrow();
		expect(index.closestTo("Daily/2026-04-20.md", "forward")).toBeNull();
		expect(index.closestTo("Daily/2026-04-10.md", "backward")).toBeNull();
	});
});

describe("AC-NOTE-09.3: a reference file that is no periodic note has no neighbours", () => {
	it("AC-NOTE-09.3: returns nothing either way from an ordinary note between periodic ones", () => {
		const index = indexOver(vaultWith("Daily/2026-04-10.md", "Notes/idea.md", "Daily/2026-04-20.md"));

		expect(index.closestTo("Notes/idea.md", "forward")).toBeNull();
		expect(index.closestTo("Notes/idea.md", "backward")).toBeNull();
	});

	it("AC-NOTE-09.3: returns nothing from a file in the daily folder whose name is no date", () => {
		const index = indexOver(vaultWith("Daily/2026-04-10.md", "Daily/shopping.md", "Daily/2026-04-20.md"));

		expect(index.closestTo("Daily/shopping.md", "forward")).toBeNull();
		expect(index.closestTo("Daily/shopping.md", "backward")).toBeNull();
	});
});
