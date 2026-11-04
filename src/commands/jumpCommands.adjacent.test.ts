import { describe, it, expect, vi, beforeEach } from "vitest";
import { jumpToClosestNote } from "./jumpCommands";
import { openNeighbourNote } from "./openNeighbourCommands";
import { openOrCreatePeriodNote } from "../notes/periodNoteOpen";
import { PeriodicNoteIndex } from "../notes/periodicNoteIndex";
import type { PeriodicConfigs } from "../notes/periodicNoteIndex";
import { DEFAULT_PERIODIC_CONFIG } from "../types";
import type { PeriodicConfig } from "../types";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";

vi.mock("../notes/periodNoteOpen", async (importOriginal) => ({
	...(await importOriginal<typeof import("../notes/periodNoteOpen")>()),
	openOrCreatePeriodNote: vi.fn(),
}));

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
const notePaths = (vault: FakeVaultPort) => vault.listNotes().map((file) => file.path);

beforeEach(() => vi.mocked(openOrCreatePeriodNote).mockClear());

describe("AC-NOTE-09.4: finding the closest existing note creates nothing for the empty neighbour", () => {
	it("AC-NOTE-09.4: skips the empty next day for the later note that exists, creating none", async () => {
		const vault = vaultWith("Daily/2026-04-13.md", "Daily/2026-04-20.md");
		const before = notePaths(vault);
		const createFile = vi.spyOn(vault, "createFile");
		const createFolder = vi.spyOn(vault, "createFolder");
		const workspace = new FakeWorkspacePort();

		await jumpToClosestNote("day", "forward", "Daily/2026-04-13.md", indexOver(vault), workspace);

		expect(workspace.opened.map(({ file }) => file.path)).toEqual(["Daily/2026-04-20.md"]);
		expect(createFile).not.toHaveBeenCalled();
		expect(createFolder).not.toHaveBeenCalled();
		expect(notePaths(vault)).toEqual(before);
		expect(openOrCreatePeriodNote).not.toHaveBeenCalled();
	});

	it("AC-NOTE-09.4: with no later note at all, says so and still creates nothing", async () => {
		const vault = vaultWith("Daily/2026-04-10.md", "Daily/2026-04-13.md");
		const before = notePaths(vault);
		const createFile = vi.spyOn(vault, "createFile");
		const workspace = new FakeWorkspacePort();

		await jumpToClosestNote("day", "forward", "Daily/2026-04-13.md", indexOver(vault), workspace);

		expect(workspace.notices).toEqual(["No next daily note."]);
		expect(workspace.opened).toEqual([]);
		expect(createFile).not.toHaveBeenCalled();
		expect(notePaths(vault)).toEqual(before);
		expect(openOrCreatePeriodNote).not.toHaveBeenCalled();
	});

	it("AC-NOTE-09.4: open-or-create is the other operation, and it alone targets the neighbouring date", async () => {
		const vault = vaultWith("Daily/2026-04-13.md", "Daily/2026-04-20.md");
		const index = indexOver(vault);
		const workspace = new FakeWorkspacePort();
		const ports = { vault, vaultConfig: new FakeVaultConfigPort(""), workspace };

		await jumpToClosestNote("day", "forward", "Daily/2026-04-13.md", index, workspace);
		expect(openOrCreatePeriodNote).not.toHaveBeenCalled();

		await openNeighbourNote("day", "forward", "Daily/2026-04-13.md", index, CONFIGS.day as PeriodicConfig, ports);
		const call = vi.mocked(openOrCreatePeriodNote).mock.calls[0];
		expect([call?.[0], call?.[1].format("YYYY-MM-DD"), call?.[3]]).toEqual(["day", "2026-04-14", null]);
	});
});
