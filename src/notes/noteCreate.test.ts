import { describe, it, expect } from "vitest";
import moment from "moment";
import { createNote } from "./noteCreate";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
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

const DATE = moment("2026-04-13T14:30:00");

describe("createNote", () => {
	it("creates the file at the given path with no template configured", async () => {
		const vault = new FakeVaultPort();

		const file = await createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault);

		expect(file.path).toBe("journal/daily/2026-04-13.md");
		expect(vault.contentAt("journal/daily/2026-04-13.md")).toBe("");
	});

	it("creates the missing target folder before creating the file (AC-ARCH-03.3: target folder missing)", async () => {
		const vault = new FakeVaultPort();

		await createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault);

		expect(vault.createdFolders).toEqual(["journal", "journal/daily"]);
	});

	it("creates every missing intermediate folder, top down (AC-NOTE-03.5)", async () => {
		const vault = new FakeVaultPort();

		await createNote("journal/daily/2026/2026-04-13.md", DATE, "day", makeConfig(), vault);

		expect(vault.createdFolders).toEqual(["journal", "journal/daily", "journal/daily/2026"]);
	});

	it("creates only the intermediate folders that are still missing (AC-NOTE-03.5)", async () => {
		const vault = new FakeVaultPort();
		vault.seedFolder("journal");

		await createNote("journal/daily/2026/2026-04-13.md", DATE, "day", makeConfig(), vault);

		expect(vault.createdFolders).toEqual(["journal/daily", "journal/daily/2026"]);
	});

	it("writes the note even though the whole folder chain was missing (AC-NOTE-03.1, AC-NOTE-03.4)", async () => {
		const vault = new FakeVaultPort();

		const file = await createNote("a/b/c/2026-04-13.md", DATE, "day", makeConfig(), vault);

		expect(file.path).toBe("a/b/c/2026-04-13.md");
		expect(vault.contentAt("a/b/c/2026-04-13.md")).toBe("");
	});

	it("creates no folder for a note at the vault root (AC-NOTE-03.3)", async () => {
		const vault = new FakeVaultPort();

		await createNote("2026-04-13.md", DATE, "day", makeConfig(), vault);

		expect(vault.createdFolders).toEqual([]);
		expect(vault.contentAt("2026-04-13.md")).toBe("");
	});

	it("does not recreate a folder that already exists", async () => {
		const vault = new FakeVaultPort();
		vault.seedFolder("journal");
		vault.seedFolder("journal/daily");

		await createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault);

		expect(vault.createdFolders).toEqual([]);
	});

	it("renders the configured template into the note content", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{title}}");

		const file = await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/daily.md" }),
			vault,
		);

		expect(vault.contentAt(file.path)).toBe("# 2026-04-13");
	});

	it("creates an empty note when the configured template is absent (AC-ARCH-03.3: template absent)", async () => {
		const vault = new FakeVaultPort();

		const file = await createNote(
			"journal/daily/2026-04-13.md",
			DATE,
			"day",
			makeConfig({ templatePath: "Templates/missing.md" }),
			vault,
		);

		expect(vault.contentAt(file.path)).toBe("");
	});

	it("propagates the failure when a note already exists at the target path (AC-ARCH-03.3: note already exists)", async () => {
		const vault = new FakeVaultPort();
		vault.seedFile("journal/daily/2026-04-13.md", "existing content");

		await expect(
			createNote("journal/daily/2026-04-13.md", DATE, "day", makeConfig(), vault),
		).rejects.toThrow("File already exists: journal/daily/2026-04-13.md");
	});

	// FMT-side filename-format validation does not exist yet (FMT epic, not built).
	// This proves the VaultPort seam already carries such a failure end-to-end
	// without inventing that validation logic here (AC-ARCH-03.3: filename format invalid).
	it("propagates a typed rejection surfaced through the port for an invalid filename format", async () => {
		const vault = new FakeVaultPort();
		vault.createFileError = new Error("Invalid filename format");

		await expect(
			createNote("journal/daily/2026:04:13.md", DATE, "day", makeConfig(), vault),
		).rejects.toThrow("Invalid filename format");
	});

	// FMT-side date-string parsing does not exist yet either (FMT epic, not built).
	// Same seam, same proof (AC-ARCH-03.3: date string unparseable).
	it("propagates a typed rejection surfaced through the port for an unparseable date string", async () => {
		const vault = new FakeVaultPort();
		vault.createFileError = new Error("Unparseable date string");

		await expect(
			createNote("journal/daily/Invalid-date.md", moment.invalid(), "day", makeConfig(), vault),
		).rejects.toThrow("Unparseable date string");
	});
});
