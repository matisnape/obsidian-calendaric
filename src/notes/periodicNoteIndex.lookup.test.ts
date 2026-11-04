import { describe, it, expect } from "vitest";
import { PeriodicNoteIndex } from "./periodicNoteIndex";
import type { PeriodicConfigs } from "./periodicNoteIndex";
import { DEFAULT_PERIODIC_CONFIG, RELEASE_GRANULARITIES } from "../types";
import type { PeriodicConfig, ReleaseGranularity } from "../types";
import type { FileGranularity } from "../fmt/resolveFileDate";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";

// Through window.moment, as source reads it: a direct import is a lint error here.
const moment = (input: string) => window.moment(input);
window.moment.locale("en");

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

/** A vault holding exactly these note paths, each with empty content. */
function vaultWith(...paths: string[]): FakeVaultPort {
	const vault = new FakeVaultPort();
	for (const path of paths) vault.seedFile(path, "");
	return vault;
}

function indexOver(vault: FakeVaultPort, configs: PeriodicConfigs = CONFIGS): PeriodicNoteIndex {
	return new PeriodicNoteIndex(vault, NO_DEFAULT_FOLDER, configs);
}

/**
 * One note per release granularity, each paired with a day inside its period
 * that is not the period's first day, so a lookup only finds it by
 * normalising the moment to the period rather than matching it as given.
 */
const NOTE_FOR: Record<ReleaseGranularity, { path: string; insideDay: string }> = {
	day: { path: "Daily/2026-04-15.md", insideDay: "2026-04-15" },
	week: { path: "Weekly/2026-W16.md", insideDay: "2026-04-16" },
	month: { path: "Monthly/2026-04.md", insideDay: "2026-04-17" },
	year: { path: "Yearly/2026.md", insideDay: "2026-07-09" },
};

const EVERY_NOTE = Object.values(NOTE_FOR).map((note) => note.path);

describe("PeriodicNoteIndex.get — AC-NOTE-01.1 an existing note is found", () => {
	for (const granularity of RELEASE_GRANULARITIES) {
		it(`AC-NOTE-01.1: returns the existing ${granularity} note's file`, () => {
			const index = indexOver(vaultWith(...EVERY_NOTE));
			const { path, insideDay } = NOTE_FOR[granularity];

			expect(index.get(granularity, moment(insideDay))?.path).toBe(path);
		});
	}
});

describe("PeriodicNoteIndex.get — AC-NOTE-01.2 a period with no note", () => {
	for (const granularity of RELEASE_GRANULARITIES) {
		it(`AC-NOTE-01.2: reports nothing for a ${granularity} with no note, writes nothing, throws nothing`, () => {
			const vault = vaultWith("Daily/2025-01-02.md");
			const index = indexOver(vault);
			const before = vault.listNotes().map((note) => note.path);

			let found: unknown = "not called";
			expect(() => {
				found = index.get(granularity, moment(NOTE_FOR[granularity].insideDay));
			}).not.toThrow();

			expect(found).toBeNull();
			expect(vault.listNotes().map((note) => note.path)).toEqual(before);
			expect(vault.pathExists(NOTE_FOR[granularity].path)).toBe(false);
			expect(vault.createdFolders).toEqual([]);
			expect(vault.appliedFoldStates).toEqual([]);
		});
	}
});

describe("PeriodicNoteIndex.get — AC-NOTE-01.3 time of day does not change the answer", () => {
	for (const granularity of RELEASE_GRANULARITIES) {
		it(`AC-NOTE-01.3: two times of day in one ${granularity} return the same note`, () => {
			const index = indexOver(vaultWith(...EVERY_NOTE));
			const { path, insideDay } = NOTE_FOR[granularity];

			expect(index.get(granularity, moment(`${insideDay}T08:15:00`))?.path).toBe(path);
			expect(index.get(granularity, moment(`${insideDay}T21:40:00`))?.path).toBe(path);
		});
	}
});

describe("PeriodicNoteIndex.get — AC-NOTE-01.4 a granularity outside the release set", () => {
	it("AC-NOTE-01.4: refuses quarter, naming it and saying it is not supported in this release", () => {
		const index = indexOver(vaultWith(...EVERY_NOTE));
		const quarter = "quarter" as unknown as FileGranularity;

		let found: unknown = "not called";
		let error: unknown = null;
		try {
			found = index.get(quarter, moment("2026-04-16"));
		} catch (thrown) {
			error = thrown;
		}

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toMatch(/\bquarter note\b/);
		expect((error as Error).message).toContain("is not supported in this release");
		expect(found).toBe("not called");
	});
});
