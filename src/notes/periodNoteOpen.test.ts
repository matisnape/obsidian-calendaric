import { describe, it, expect, afterEach } from "vitest";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { openOrCreatePeriodNote, startUp } from "./periodNoteOpen";
import { guardCreation, PredecessorGuard } from "./predecessorGuard";
import type { ReleaseGranularity, PeriodicConfig } from "../types";

/**
 * The command and startup paths, driven against fakes. A predecessor is
 * reduced to one fact: Periodic Notes has these granularities on.
 */
function setUp(periodic: ReleaseGranularity[]) {
	const ports = { vault: new FakeVaultPort(), vaultConfig: new FakeVaultConfigPort(), workspace: new FakeWorkspacePort() };
	const guard = new PredecessorGuard(
		{
			companion: { readDailyNotes: () => ({ ok: true, value: { enabled: false } }), disableDailyNotes: () => ({ ok: true }) },
			calendar: {
				readCalendarWeeklyNotes: () => ({ ok: true, value: false }),
				disableCalendarWeeklyNotes: async () => ({ ok: true }),
			},
			periodicNotes: {
				readActiveGranularities: () => ({ ok: true, value: periodic }),
				disableGranularity: async () => ({ ok: true }),
			},
		},
		() => true,
		(message) => ports.workspace.showNotice(message),
	);
	guardCreation(ports.vault.backingVault, guard);
	registered.push(ports.vault.backingVault);
	return ports;
}

const registered: object[] = [];
afterEach(() => {
	for (const vault of registered.splice(0)) guardCreation(vault, null);
});

const config = (overrides: Partial<PeriodicConfig> = {}): PeriodicConfig => ({
	enabled: true,
	format: "YYYY-MM-DD",
	folder: "Daily",
	templatePath: "",
	allowPrefixMatch: false,
	openAtStartup: false,
	...overrides,
});

const date = () => window.moment("2026-04-13");
const PATH = "Daily/2026-04-13.md";

function settings(day: PeriodicConfig): Record<ReleaseGranularity, PeriodicConfig> {
	const off = config({ enabled: false });
	return { day, week: off, month: off, year: off };
}

describe("openOrCreatePeriodNote: a granularity command", () => {
	it("AC-MIG-06.1: a command for an owned granularity creates nothing and says which plugin owns it", async () => {
		const ports = setUp(["day"]);

		await openOrCreatePeriodNote("day", date(), config(), null, ports);

		expect(ports.vault.getFile(PATH)).toBeNull();
		expect(ports.vault.folderExists("Daily")).toBe(false);
		expect(ports.workspace.opened).toEqual([]);
		expect(ports.workspace.notices).toEqual([expect.stringContaining("Periodic Notes")]);
	});

	it("AC-MIG-06.1: a command for an owned granularity still opens the note that already exists", async () => {
		const ports = setUp(["day"]);
		ports.vault.seedFile(PATH, "written by Periodic Notes");

		await openOrCreatePeriodNote("day", date(), config(), ports.vault.getFile(PATH), ports);

		expect(ports.workspace.opened.map((entry) => entry.file.path)).toEqual([PATH]);
		expect(ports.workspace.notices).toEqual([]);
	});

	it("creates and opens the note when no predecessor owns the granularity", async () => {
		const ports = setUp([]);

		await openOrCreatePeriodNote("day", date(), config(), null, ports);

		expect(ports.vault.getFile(PATH)).not.toBeNull();
		expect(ports.workspace.opened.map((entry) => entry.file.path)).toEqual([PATH]);
	});
});

describe("startUp", () => {
	it("AC-MIG-06.2: with no predecessor enabled, startup shows no notice and opens the startup note", async () => {
		const ports = setUp([]);

		await startUp(settings(config({ openAtStartup: true })), date(), ports);

		expect(ports.workspace.notices).toEqual([]);
		expect(ports.workspace.opened).toEqual([{ file: ports.vault.getFile(PATH), mode: "tab" }]);
	});

	it("AC-MIG-06.2: startup names a predecessor that overlaps Calendaric", async () => {
		const ports = setUp(["day"]);

		await startUp(settings(config()), date(), ports);

		expect(ports.workspace.notices).toEqual([expect.stringMatching(/Periodic Notes.*daily notes/)]);
	});

	it("AC-MIG-06.1: startup does not write a startup note a predecessor owns, and says so only once", async () => {
		const ports = setUp(["day"]);

		await startUp(settings(config({ openAtStartup: true })), date(), ports);

		expect(ports.vault.getFile(PATH)).toBeNull();
		expect(ports.workspace.opened).toEqual([]);
		expect(ports.workspace.notices).toHaveLength(1);
	});

	it("says what is in the way when the startup note cannot be written", async () => {
		const ports = setUp([]);
		ports.vault.seedFolder(PATH);

		await startUp(settings(config({ openAtStartup: true })), date(), ports);

		expect(ports.workspace.opened).toEqual([]);
		expect(ports.workspace.notices).toEqual([expect.stringContaining(PATH)]);
	});

	it("AC-MIG-06.1: startup still opens an owned startup note that already exists", async () => {
		const ports = setUp(["day"]);
		ports.vault.seedFile(PATH, "written by Periodic Notes");

		await startUp(settings(config({ openAtStartup: true })), date(), ports);

		expect(ports.workspace.opened.map((entry) => entry.file.path)).toEqual([PATH]);
	});
});
