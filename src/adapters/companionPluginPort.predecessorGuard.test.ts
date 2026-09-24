import { describe, it, expect } from "vitest";
import type {
	CalendarPluginPort,
	CompanionPluginAction,
	CompanionPluginRead,
	DailyNotesPluginState,
} from "./companionPluginPort";
import { FakeVaultPort } from "./fakeVaultPort";
import { FakeVaultConfigPort } from "./fakeVaultConfigPort";
import { FakeWorkspacePort } from "./fakeWorkspacePort";
import { guardCreation, PredecessorGuard } from "../notes/predecessorGuard";
import type { NoticeAction, PredecessorPorts } from "../notes/predecessorGuard";
import { openOrCreateNote } from "../ui/cellActions";
import type { ReleaseGranularity, PeriodicConfig } from "../types";

/**
 * The three predecessors as mutable fakes of the widened ports. Each one holds
 * the state its plugin would report, and each `disable` changes that state the
 * way the plugin's own settings write would — unless `sticky` says the plugin
 * kept the granularity on anyway, which is the case AC-MIG-06.6 is about.
 */
function makePredecessors() {
	const state = {
		dailyNotes: false,
		calendarWeekly: false,
		periodic: [] as string[],
		sticky: false,
		disableCalls: [] as string[],
	};

	const read = <T>(value: T): CompanionPluginRead<T> => ({ ok: true, value });
	const absent = <T>(): CompanionPluginRead<T> => ({ ok: false, reason: "absent", problem: "not installed" });
	const done: CompanionPluginAction = { ok: true };

	const ports: PredecessorPorts = {
		companion: {
			readDailyNotes: (): CompanionPluginRead<DailyNotesPluginState> =>
				state.dailyNotes
					? read({ enabled: true, format: "", folder: "", template: "" })
					: read({ enabled: false }),
			disableDailyNotes: () => {
				state.disableCalls.push("daily-notes");
				if (!state.sticky) state.dailyNotes = false;
				return done;
			},
		},
		calendar: {
			readCalendarWeeklyNotes: () => (state.calendarWeekly ? read(true) : absent()),
			disableCalendarWeeklyNotes: async () => {
				state.disableCalls.push("calendar");
				if (!state.sticky) state.calendarWeekly = false;
				return done;
			},
		} satisfies CalendarPluginPort,
		periodicNotes: {
			readActiveGranularities: () => read([...state.periodic]),
			disableGranularity: (name: string) => {
				state.disableCalls.push(`periodic-notes:${name}`);
				if (!state.sticky) state.periodic = state.periodic.filter((entry) => entry !== name);
				return done;
			},
		},
	};

	return { state, ports };
}

interface Shown {
	message: string;
	action?: NoticeAction;
}

function makeGuard(enabled: ReleaseGranularity[] = ["day", "week", "month"]) {
	const { state, ports } = makePredecessors();
	const shown: Shown[] = [];
	const guard = new PredecessorGuard(
		ports,
		(granularity) => enabled.includes(granularity),
		(message, action) => shown.push({ message, action }),
	);
	return { state, guard, shown };
}

const dayConfig: PeriodicConfig = {
	enabled: true,
	format: "YYYY-MM-DD",
	folder: "Daily",
	templatePath: "",
	allowPrefixMatch: false,
	openAtStartup: false,
};

function makeCellPorts() {
	return { vault: new FakeVaultPort(), vaultConfig: new FakeVaultConfigPort(), workspace: new FakeWorkspacePort() };
}

function clickDay(ports: ReturnType<typeof makeCellPorts>, asked: string[] = []) {
	return openOrCreateNote({
		date: window.moment("2026-04-13"),
		granularity: "day",
		config: dayConfig,
		confirmBeforeCreate: true,
		event: { metaKey: false, ctrlKey: false } as MouseEvent,
		ports,
		confirmCreate: async (request) => {
			asked.push(request.title);
			return true;
		},
	});
}

describe("PredecessorGuard: refusing a granularity a predecessor still owns", () => {
	it("AC-MIG-06.1: refuses a daily note while core Daily Notes is enabled and names that plugin", () => {
		const { state, guard, shown } = makeGuard();
		state.dailyNotes = true;

		expect(guard.refuse("day")).toBe(true);
		expect(shown).toHaveLength(1);
		expect(shown[0]!.message).toContain("Daily Notes");
		expect(shown[0]!.message).toContain("daily");
	});

	it("AC-MIG-06.1: refuses a weekly note while the Calendar plugin has weekly notes on and names that plugin", () => {
		const { state, guard, shown } = makeGuard();
		state.calendarWeekly = true;

		expect(guard.refuse("week")).toBe(true);
		expect(shown[0]!.message).toContain("Calendar plugin");
		expect(guard.refuse("day")).toBe(false);
	});

	it("AC-MIG-06.1: refuses only the granularities Periodic Notes' active set enables", () => {
		const { state, guard, shown } = makeGuard();
		state.periodic = ["month"];

		expect(guard.refuse("month")).toBe(true);
		expect(shown[0]!.message).toContain("Periodic Notes");
		expect(guard.refuse("day")).toBe(false);
		expect(guard.refuse("week")).toBe(false);
	});

	it("AC-MIG-06.1: leaves a granularity alone that Calendaric itself has switched off", () => {
		const { state, guard, shown } = makeGuard(["day"]);
		state.periodic = ["week"];

		expect(guard.refuse("week")).toBe(false);
		expect(shown).toHaveLength(0);
	});

	it("AC-MIG-06.1: a calendar click on an owned granularity creates nothing, asks nothing, and says why", async () => {
		const { state, guard } = makeGuard();
		state.periodic = ["day"];
		const ports = makeCellPorts();
		guardCreation(ports.vault.backingVault, guard);
		const asked: string[] = [];

		await clickDay(ports, asked);

		expect(ports.vault.getFile("Daily/2026-04-13.md")).toBeNull();
		expect(ports.vault.folderExists("Daily")).toBe(false);
		expect(asked).toEqual([]);
		expect(ports.workspace.opened).toEqual([]);
	});

	it("AC-MIG-06.1: a calendar click on an owned granularity still opens the note that already exists", async () => {
		const { state, guard, shown } = makeGuard();
		state.periodic = ["day"];
		const ports = makeCellPorts();
		ports.vault.seedFile("Daily/2026-04-13.md", "written by Periodic Notes");
		guardCreation(ports.vault.backingVault, guard);

		await clickDay(ports);

		expect(ports.workspace.opened.map((entry) => entry.file.path)).toEqual(["Daily/2026-04-13.md"]);
		expect(shown).toHaveLength(0);
	});

	it("AC-MIG-06.1: the notice offers to hand the granularity to Calendaric", () => {
		const { state, guard, shown } = makeGuard();
		state.periodic = ["day"];

		guard.refuse("day");

		expect(shown[0]!.action?.label).toBe("Use Calendaric");
	});
});

describe("PredecessorGuard.announce: the startup check", () => {
	it("AC-MIG-06.2: shows no notice when no predecessor is enabled", () => {
		const { guard, shown } = makeGuard();

		guard.announce();

		expect(shown).toEqual([]);
	});

	it("AC-MIG-06.2: shows no notice when a predecessor owns only granularities Calendaric has off", () => {
		const { state, guard, shown } = makeGuard(["day"]);
		state.periodic = ["week", "month"];
		state.calendarWeekly = true;

		guard.announce();

		expect(shown).toEqual([]);
	});

	it("AC-MIG-06.2: shows one notice per predecessor that overlaps Calendaric", () => {
		const { state, guard, shown } = makeGuard();
		state.periodic = ["day", "week"];
		state.calendarWeekly = true;

		guard.announce();

		// Periodic Notes owns the day; the week goes to the Calendar plugin,
		// which is named first when two predecessors both claim it.
		expect(shown.map((entry) => entry.message)).toEqual([
			expect.stringMatching(/Periodic Notes.*daily notes/),
			expect.stringMatching(/Calendar plugin.*weekly notes/),
		]);
	});
});

describe("PredecessorGuard: a predecessor that cannot be read", () => {
	it("AC-MIG-06.4: treats a port that throws as a plugin that is not enabled", () => {
		const shown: Shown[] = [];
		const throwing = new PredecessorGuard(
			{
				companion: {
					readDailyNotes: () => {
						throw new Error("registry exploded");
					},
					disableDailyNotes: () => ({ ok: true }),
				},
				calendar: {
					readCalendarWeeklyNotes: () => {
						throw new Error("registry exploded");
					},
					disableCalendarWeeklyNotes: async () => ({ ok: true }),
				},
				periodicNotes: {
					readActiveGranularities: () => {
						throw new Error("registry exploded");
					},
					disableGranularity: () => ({ ok: true }),
				},
			},
			() => true,
			(message) => shown.push({ message }),
		);

		expect(() => throwing.refuse("day")).not.toThrow();
		expect(throwing.refuse("week")).toBe(false);
		expect(() => throwing.announce()).not.toThrow();
		expect(shown).toEqual([]);
	});

	it("AC-MIG-06.4: treats an unreadable registry answer as a plugin that is not enabled", () => {
		const shown: Shown[] = [];
		const unreadable = <T>(): CompanionPluginRead<T> => ({ ok: false, reason: "mismatch", problem: "odd" });
		const guard = new PredecessorGuard(
			{
				companion: { readDailyNotes: unreadable, disableDailyNotes: () => ({ ok: true }) },
				calendar: { readCalendarWeeklyNotes: unreadable, disableCalendarWeeklyNotes: async () => ({ ok: true }) },
				periodicNotes: { readActiveGranularities: unreadable, disableGranularity: () => ({ ok: true }) },
			},
			() => true,
			(message) => shown.push({ message }),
		);

		expect(guard.refuse("day")).toBe(false);
		expect(guard.refuse("week")).toBe(false);
		expect(shown).toEqual([]);
	});
});

describe("PredecessorGuard: handing a granularity to Calendaric", () => {
	it("AC-MIG-06.5: turns the granularity off in the predecessor and resumes once the re-read says off", async () => {
		const { state, guard, shown } = makeGuard();
		state.periodic = ["day", "week"];

		guard.refuse("day");
		await shown[0]!.action!.run();

		expect(state.disableCalls).toEqual(["periodic-notes:day"]);
		expect(state.periodic).toEqual(["week"]);
		expect(shown.at(-1)!.message).toContain("Calendaric now manages daily notes");
		expect(guard.refuse("day")).toBe(false);
		expect(guard.refuse("week")).toBe(true);
	});

	it("AC-MIG-06.5: a click after the hand-over creates the note", async () => {
		const { state, guard, shown } = makeGuard();
		state.dailyNotes = true;
		const ports = makeCellPorts();
		guardCreation(ports.vault.backingVault, guard);

		await clickDay(ports);
		expect(ports.vault.getFile("Daily/2026-04-13.md")).toBeNull();

		await shown[0]!.action!.run();
		await clickDay(ports);

		expect(state.disableCalls).toEqual(["daily-notes"]);
		expect(ports.vault.getFile("Daily/2026-04-13.md")).not.toBeNull();
	});

	it("AC-MIG-06.5: turns the Calendar plugin's weekly notes off through its own port", async () => {
		const { state, guard, shown } = makeGuard();
		state.calendarWeekly = true;

		guard.refuse("week");
		await shown[0]!.action!.run();

		expect(state.disableCalls).toEqual(["calendar"]);
		expect(guard.refuse("week")).toBe(false);
	});

	it("AC-MIG-06.6: keeps refusing when the re-read still says the predecessor has the granularity on", async () => {
		const { state, guard, shown } = makeGuard();
		state.periodic = ["day"];
		state.sticky = true;

		guard.refuse("day");
		await shown[0]!.action!.run();

		expect(state.disableCalls).toEqual(["periodic-notes:day"]);
		expect(shown.at(-1)!.message).toContain("still");
		expect(shown.at(-1)!.message).not.toContain("now manages");
		expect(guard.refuse("day")).toBe(true);
	});

	it("AC-MIG-06.6: keeps refusing a calendar click when the predecessor ignored the hand-over", async () => {
		const { state, guard, shown } = makeGuard();
		state.dailyNotes = true;
		state.sticky = true;
		const ports = makeCellPorts();
		guardCreation(ports.vault.backingVault, guard);

		await clickDay(ports);
		await shown[0]!.action!.run();
		await clickDay(ports);

		expect(ports.vault.getFile("Daily/2026-04-13.md")).toBeNull();
	});

	it("AC-MIG-06.6: says so when the predecessor refused the write, and keeps refusing", async () => {
		const shown: Shown[] = [];
		let periodic = ["day"];
		const guard = new PredecessorGuard(
			{
				companion: {
					readDailyNotes: () => ({ ok: true, value: { enabled: false } }),
					disableDailyNotes: () => ({ ok: true }),
				},
				calendar: {
					readCalendarWeeklyNotes: () => ({ ok: true, value: false }),
					disableCalendarWeeklyNotes: async () => ({ ok: true }),
				},
				periodicNotes: {
					readActiveGranularities: () => ({ ok: true, value: periodic }),
					disableGranularity: () => ({ ok: false, problem: "no settings store" }),
				},
			},
			() => true,
			(message, action) => shown.push({ message, action }),
		);

		guard.refuse("day");
		await shown[0]!.action!.run();

		expect(shown.map((entry) => entry.message).join("\n")).toContain("no settings store");
		expect(guard.refuse("day")).toBe(true);
		periodic = [];
		expect(guard.refuse("day")).toBe(false);
	});
});
