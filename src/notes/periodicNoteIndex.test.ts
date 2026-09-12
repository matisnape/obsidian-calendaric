import { describe, it, expect } from "vitest";
import moment from "moment";
moment.locale("en");
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

describe("PeriodicNoteIndex — AC-NOTE-11.1 files already in the vault at startup", () => {
	it("AC-NOTE-11.1: returns a daily note that existed before the index was built", () => {
		const index = indexOver(vaultWith("Daily/2026-04-13.md"));

		expect(index.get("day", moment("2026-04-13"))?.path).toBe("Daily/2026-04-13.md");
	});

	it("AC-NOTE-11.1: returns a weekly note that existed before the index was built", () => {
		const index = indexOver(vaultWith("Weekly/2026-W16.md"));

		expect(index.get("week", moment("2026-04-13"))?.path).toBe("Weekly/2026-W16.md");
	});

	it("AC-NOTE-11.1: answers nothing for a period with no note", () => {
		const index = indexOver(vaultWith("Daily/2026-04-13.md"));

		expect(index.get("day", moment("2026-04-14"))).toBeNull();
	});

	it("AC-NOTE-11.1: reads the vault once, not once per lookup", () => {
		const vault = vaultWith("Daily/2026-04-13.md");
		const index = indexOver(vault);
		const afterBuild = vault.listNotesCalls;

		index.get("day", moment("2026-04-13"));
		index.get("day", moment("2026-04-14"));

		expect(vault.listNotesCalls).toBe(afterBuild);
	});
});

describe("PeriodicNoteIndex — AC-NOTE-11.2 a file created after the index was built", () => {
	it("AC-NOTE-11.2: returns a note created after the index was built", () => {
		const vault = vaultWith();
		const index = indexOver(vault);
		expect(index.get("day", moment("2026-04-13"))).toBeNull();

		vault.seedFile("Daily/2026-04-13.md", "");
		vault.emitChange({ kind: "create", file: { path: "Daily/2026-04-13.md" } });

		expect(index.get("day", moment("2026-04-13"))?.path).toBe("Daily/2026-04-13.md");
	});
});

describe("PeriodicNoteIndex — AC-NOTE-11.3 a rename that keeps the file periodic", () => {
	it("AC-NOTE-11.3: returns the file under its new name after a rename within the same period", () => {
		const vault = vaultWith("Daily/2026-04-13.md");
		const index = indexOver(vault);

		vault.renameFile("Daily/2026-04-13.md", "Daily/Sub/2026-04-13.md");
		vault.emitChange({
			kind: "rename",
			file: { path: "Daily/Sub/2026-04-13.md" },
			oldPath: "Daily/2026-04-13.md",
		});

		expect(index.get("day", moment("2026-04-13"))?.path).toBe("Daily/Sub/2026-04-13.md");
	});

	it("AC-NOTE-11.3: moves the file to the period its new name names", () => {
		const vault = vaultWith("Daily/2026-04-13.md");
		const index = indexOver(vault);

		vault.renameFile("Daily/2026-04-13.md", "Daily/2026-04-14.md");
		vault.emitChange({
			kind: "rename",
			file: { path: "Daily/2026-04-14.md" },
			oldPath: "Daily/2026-04-13.md",
		});

		expect(index.get("day", moment("2026-04-13"))).toBeNull();
		expect(index.get("day", moment("2026-04-14"))?.path).toBe("Daily/2026-04-14.md");
	});

	it("AC-NOTE-11.3: picks up an external script's rename from a raw title to a pretty one", () => {
		// The vault's weekly Templater script renames the raw note Obsidian
		// made to the long pretty title and moves it into the weekly folder
		// (docs/mapping/sources/vault.json). Nothing tells the plugin; the
		// vault's own rename event is what reports it.
		const configs: PeriodicConfigs = {
			day: config("YYYY-MM-DD", "Daily"),
			week: config("GGGG-[W]WW[, ]{{monday:DD.MM}}", "Weekly"),
		};
		const vault = vaultWith("Untitled.md");
		const index = indexOver(vault, configs);
		expect(index.get("week", moment("2026-04-13"))).toBeNull();

		vault.renameFile("Untitled.md", "Weekly/2026-W16, 13.04.md");
		vault.emitChange({
			kind: "rename",
			file: { path: "Weekly/2026-W16, 13.04.md" },
			oldPath: "Untitled.md",
		});

		expect(index.get("week", moment("2026-04-13"))?.path).toBe("Weekly/2026-W16, 13.04.md");
	});
});

describe("PeriodicNoteIndex — AC-NOTE-11.4 a matching name outside every configured folder", () => {
	it("AC-NOTE-11.4: answers nothing for a daily name that sits outside the daily folder", () => {
		const index = indexOver(vaultWith("Archive/2026-04-13.md"));

		expect(index.get("day", moment("2026-04-13"))).toBeNull();
	});

	it("AC-NOTE-11.4: answers nothing for a daily name at the vault root", () => {
		const index = indexOver(vaultWith("2026-04-13.md"));

		expect(index.get("day", moment("2026-04-13"))).toBeNull();
	});

	it("AC-NOTE-11.4: answers nothing when such a file is created after the index was built", () => {
		const vault = vaultWith();
		const index = indexOver(vault);

		vault.seedFile("Archive/2026-04-13.md", "");
		vault.emitChange({ kind: "create", file: { path: "Archive/2026-04-13.md" } });

		expect(index.get("day", moment("2026-04-13"))).toBeNull();
	});
});

describe("PeriodicNoteIndex — AC-NOTE-11.5 a settings change", () => {
	it("AC-NOTE-11.5: a lookup after the change reflects the new folder", () => {
		const index = indexOver(vaultWith("Journal/2026-04-13.md"));
		expect(index.get("day", moment("2026-04-13"))).toBeNull();

		index.applySettings({ ...CONFIGS, day: config("YYYY-MM-DD", "Journal") });

		expect(index.get("day", moment("2026-04-13"))?.path).toBe("Journal/2026-04-13.md");
	});

	it("AC-NOTE-11.5: a file that only matches under the new format is now returned", () => {
		const index = indexOver(vaultWith("Daily/13.04.2026.md"));
		expect(index.get("day", moment("2026-04-13"))).toBeNull();

		index.applySettings({ ...CONFIGS, day: config("DD.MM.YYYY", "Daily") });

		expect(index.get("day", moment("2026-04-13"))?.path).toBe("Daily/13.04.2026.md");
	});

	it("AC-NOTE-11.5: a file that no longer matches is no longer returned by any lookup", () => {
		const index = indexOver(vaultWith("Daily/2026-04-13.md"));
		expect(index.get("day", moment("2026-04-13"))?.path).toBe("Daily/2026-04-13.md");

		index.applySettings({ ...CONFIGS, day: config("YYYY-MM-DD", "Journal") });

		expect(index.get("day", moment("2026-04-13"))).toBeNull();
		expect(index.paths()).not.toContain("Daily/2026-04-13.md");
	});
});

describe("PeriodicNoteIndex — AC-NOTE-11.6 a periodic date in the frontmatter", () => {
	it("AC-NOTE-11.6: returns a file whose frontmatter names the day, though its name does not", () => {
		const vault = vaultWith("Daily/Monday planning.md");
		expect(indexOver(vault).get("day", moment("2026-04-13"))).toBeNull();

		vault.seedFrontmatter("Daily/Monday planning.md", { day: "2026-04-13" });

		expect(indexOver(vault).get("day", moment("2026-04-13"))?.path).toBe("Daily/Monday planning.md");
	});

	it("AC-NOTE-11.6: returns a file whose frontmatter names the week", () => {
		const vault = vaultWith("Weekly/Planning.md");
		vault.seedFrontmatter("Weekly/Planning.md", { week: "2026-W16" });

		expect(indexOver(vault).get("week", moment("2026-04-13"))?.path).toBe("Weekly/Planning.md");
	});

	it("AC-NOTE-11.6: ignores a frontmatter date on a file outside every configured folder", () => {
		const vault = vaultWith("Archive/Monday planning.md");
		vault.seedFrontmatter("Archive/Monday planning.md", { day: "2026-04-13" });

		expect(indexOver(vault).get("day", moment("2026-04-13"))).toBeNull();
	});

	it("AC-NOTE-11.6: picks up frontmatter written after the file was created", () => {
		const vault = vaultWith("Daily/Monday planning.md");
		const index = indexOver(vault);

		vault.seedFrontmatter("Daily/Monday planning.md", { day: "2026-04-13" });
		vault.emitChange({ kind: "metadata", file: { path: "Daily/Monday planning.md" } });

		expect(index.get("day", moment("2026-04-13"))?.path).toBe("Daily/Monday planning.md");
	});
});

describe("PeriodicNoteIndex — AC-NOTE-11.7 a deleted file", () => {
	it("AC-NOTE-11.7: answers nothing for a period whose note was deleted", () => {
		const vault = vaultWith("Daily/2026-04-13.md");
		const index = indexOver(vault);
		expect(index.get("day", moment("2026-04-13"))?.path).toBe("Daily/2026-04-13.md");

		vault.deleteFile("Daily/2026-04-13.md");
		vault.emitChange({ kind: "delete", file: { path: "Daily/2026-04-13.md" } });

		expect(index.get("day", moment("2026-04-13"))).toBeNull();
		expect(index.paths()).not.toContain("Daily/2026-04-13.md");
	});
});

describe("PeriodicNoteIndex — the subscription it owns", () => {
	it("stops listening once destroyed", () => {
		const vault = vaultWith();
		const index = indexOver(vault);

		index.destroy();
		vault.seedFile("Daily/2026-04-13.md", "");
		vault.emitChange({ kind: "create", file: { path: "Daily/2026-04-13.md" } });

		expect(index.get("day", moment("2026-04-13"))).toBeNull();
	});

	it("keeps the period that a second file took over when the first one goes", () => {
		// Two names can describe one day; the index answers with the last one
		// it saw, and losing the older file must not drop the period.
		const vault = vaultWith("Daily/2026-04-13.md", "Daily/Sub/2026-04-13.md");
		const index = indexOver(vault);
		const held = index.get("day", moment("2026-04-13"))?.path;
		const other = held === "Daily/2026-04-13.md" ? "Daily/Sub/2026-04-13.md" : "Daily/2026-04-13.md";

		vault.deleteFile(other);
		vault.emitChange({ kind: "delete", file: { path: other } });

		expect(index.get("day", moment("2026-04-13"))?.path).toBe(held);
	});
});

const ALL_CONFIGS: PeriodicConfigs = {
	...CONFIGS,
	month: config("YYYY-MM", "Monthly"),
	year: config("YYYY", "Yearly"),
};

describe("PeriodicNoteIndex — the granularities beyond day and week", () => {
	it("returns a monthly note for any day inside that month", () => {
		const index = indexOver(vaultWith("Monthly/2026-04.md"), ALL_CONFIGS);

		expect(index.get("month", moment("2026-04-13"))?.path).toBe("Monthly/2026-04.md");
		expect(index.get("month", moment("2026-04-30"))?.path).toBe("Monthly/2026-04.md");
	});

	it("returns a yearly note for any day inside that year", () => {
		const index = indexOver(vaultWith("Yearly/2026.md"), ALL_CONFIGS);

		expect(index.get("year", moment("2026-04-13"))?.path).toBe("Yearly/2026.md");
		expect(index.get("year", moment("2026-12-31"))?.path).toBe("Yearly/2026.md");
	});

	it("answers nothing for a month or a year the vault holds no note for", () => {
		const index = indexOver(vaultWith("Monthly/2026-04.md", "Yearly/2026.md"), ALL_CONFIGS);

		expect(index.get("month", moment("2026-05-01"))).toBeNull();
		expect(index.get("year", moment("2027-04-13"))).toBeNull();
	});

	it("keeps a granularity left out of the configuration out of the index", () => {
		// CONFIGS names day and week only, so a monthly note is an ordinary file.
		const index = indexOver(vaultWith("Monthly/2026-04.md"), CONFIGS);

		expect(index.paths()).not.toContain("Monthly/2026-04.md");
	});
});

describe("PeriodicNoteIndex — the closest note in one direction", () => {
	it("returns the nearest later note, not merely a later one", () => {
		const index = indexOver(
			vaultWith("Daily/2026-04-13.md", "Daily/2026-04-15.md", "Daily/2026-04-20.md"),
		);

		expect(index.closest("day", moment("2026-04-13"), "forward")?.path).toBe("Daily/2026-04-15.md");
	});

	it("returns the nearest earlier note, not merely an earlier one", () => {
		const index = indexOver(
			vaultWith("Daily/2026-04-01.md", "Daily/2026-04-10.md", "Daily/2026-04-13.md"),
		);

		expect(index.closest("day", moment("2026-04-13"), "backward")?.path).toBe("Daily/2026-04-10.md");
	});

	it("never answers with the note for the period it was asked from", () => {
		const index = indexOver(vaultWith("Daily/2026-04-13.md"));

		expect(index.closest("day", moment("2026-04-13"), "forward")).toBeNull();
		expect(index.closest("day", moment("2026-04-13"), "backward")).toBeNull();
	});

	it("answers nothing when the vault holds no note in that direction", () => {
		const index = indexOver(vaultWith("Daily/2026-04-13.md"));

		expect(index.closest("day", moment("2026-04-20"), "forward")).toBeNull();
		expect(index.closest("day", moment("2026-04-01"), "backward")).toBeNull();
	});

	it("looks only at the granularity it was asked for", () => {
		const index = indexOver(
			vaultWith("Weekly/2026-W17.md", "Daily/2026-05-01.md"),
			ALL_CONFIGS,
		);

		// A later weekly note exists; a later DAILY one does not.
		expect(index.closest("week", moment("2026-04-13"), "forward")?.path).toBe("Weekly/2026-W17.md");
		expect(index.closest("day", moment("2026-05-01"), "forward")).toBeNull();
	});

	it("finds the closest monthly and yearly note too", () => {
		const index = indexOver(
			vaultWith("Monthly/2026-02.md", "Monthly/2026-07.md", "Yearly/2024.md", "Yearly/2028.md"),
			ALL_CONFIGS,
		);

		expect(index.closest("month", moment("2026-04-13"), "backward")?.path).toBe("Monthly/2026-02.md");
		expect(index.closest("month", moment("2026-04-13"), "forward")?.path).toBe("Monthly/2026-07.md");
		expect(index.closest("year", moment("2026-04-13"), "backward")?.path).toBe("Yearly/2024.md");
		expect(index.closest("year", moment("2026-04-13"), "forward")?.path).toBe("Yearly/2028.md");
	});
});
