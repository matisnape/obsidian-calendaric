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
 * `unsaved` is the other AC-MIG-06.6 case, in the order the real plugins run
 * it: the setting changes in memory, then the save fails and the write says so.
 */
function makePredecessors() {
	const state = {
		dailyNotes: false,
		calendarWeekly: false,
		periodic: [] as string[],
		sticky: false,
		unsaved: false,
		disableCalls: [] as string[],
	};

	const read = <T>(value: T): CompanionPluginRead<T> => ({ ok: true, value });
	const absent = <T>(): CompanionPluginRead<T> => ({ ok: false, reason: "absent", problem: "not installed" });
	const outcome = (): CompanionPluginAction =>
		state.unsaved ? { ok: false, problem: "saving data.json failed" } : { ok: true };

	const ports: PredecessorPorts = {
		companion: {
			readDailyNotes: (): CompanionPluginRead<DailyNotesPluginState> =>
				state.dailyNotes
					? read({ enabled: true, format: "", folder: "", template: "" })
					: read({ enabled: false }),
			disableDailyNotes: () => {
				state.disableCalls.push("daily-notes");
				if (!state.sticky) state.dailyNotes = false;
				return outcome();
			},
		},
		calendar: {
			readCalendarWeeklyNotes: () => (state.calendarWeekly ? read(true) : absent()),
			disableCalendarWeeklyNotes: async () => {
				state.disableCalls.push("calendar");
				if (!state.sticky) state.calendarWeekly = false;
				return outcome();
			},
		} satisfies CalendarPluginPort,
		periodicNotes: {
			readActiveGranularities: () => read([...state.periodic]),
			disableGranularity: async (name: string) => {
				state.disableCalls.push(`periodic-notes:${name}`);
				if (!state.sticky) state.periodic = state.periodic.filter((entry) => entry !== name);
				return outcome();
			},
		},
	};

	return { state, ports };
}

interface Shown {
	message: string;
	action?: NoticeAction;
	/** Whether the notice stays until dismissed. */
	stays?: boolean;
}

function makeGuard(enabled: ReleaseGranularity[] = ["day", "week", "month"]) {
	const { state, ports } = makePredecessors();
	const shown: Shown[] = [];
	const guard = new PredecessorGuard(
		ports,
		(granularity) => enabled.includes(granularity),
		(message, action, sticky) => shown.push({ message, action, stays: sticky === true }),
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

	it("AC-MIG-06.1: a refusal repeated on every click times out instead of staying on screen", () => {
		const { state, guard, shown } = makeGuard();
		state.periodic = ["day"];

		guard.refuse("day");
		guard.refuse("day");

		expect(shown.map((entry) => entry.stays)).toEqual([false, false]);
	});

	it("AC-MIG-06.1: a quiet refusal still refuses but shows nothing", () => {
		const { state, guard, shown } = makeGuard();
		state.periodic = ["day"];

		expect(guard.refuse("day", true)).toBe(true);
		expect(shown).toEqual([]);
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

		// Both claim the week, so each notice lists it: either hand-over alone
		// would leave the week with the other plugin.
		expect(shown.map((entry) => entry.message)).toEqual([
			expect.stringMatching(/Periodic Notes.*daily and weekly notes/),
			expect.stringMatching(/Calendar plugin.*weekly notes/),
		]);
		expect(shown.map((entry) => entry.stays)).toEqual([true, true]);
	});

	it("AC-MIG-06.2: offers each plugin's hand-over when two of them own the day", () => {
		const { state, guard, shown } = makeGuard();
		state.dailyNotes = true;
		state.periodic = ["day"];

		guard.announce();

		expect(shown.map((entry) => entry.message)).toEqual([
			expect.stringMatching(/core Daily Notes.*daily notes/),
			expect.stringMatching(/Periodic Notes.*daily notes/),
		]);
		expect(shown.every((entry) => entry.action?.label === "Use Calendaric")).toBe(true);
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
					disableGranularity: async () => ({ ok: true }),
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
				periodicNotes: { readActiveGranularities: unreadable, disableGranularity: async () => ({ ok: true }) },
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

	it("AC-MIG-06.6: keeps refusing when the setting changed in memory but the save failed", async () => {
		const { state, guard, shown } = makeGuard();
		state.periodic = ["day"];
		state.unsaved = true;

		guard.refuse("day");
		await shown[0]!.action!.run();

		// The plugin now reads "off" from memory, but data.json still says on.
		expect(state.periodic).toEqual([]);
		const messages = shown.map((entry) => entry.message).join("\n");
		expect(messages).toContain("saving data.json failed");
		expect(messages).not.toContain("now manages");
		expect(guard.refuse("day")).toBe(true);
	});

	it("AC-MIG-06.5: a later hand-over that saves lifts a refusal an unsaved one left", async () => {
		const { state, guard, shown } = makeGuard();
		state.periodic = ["day"];
		state.unsaved = true;
		guard.refuse("day");
		await shown[0]!.action!.run();

		state.unsaved = false;
		guard.refuse("day");
		await shown.at(-1)!.action!.run();

		expect(shown.at(-1)!.message).toContain("Calendaric now manages daily notes");
		expect(guard.refuse("day")).toBe(false);
	});

	it("AC-MIG-06.6: after one of two owners hands the day over, names the other and offers its hand-over", async () => {
		const { state, guard, shown } = makeGuard();
		state.dailyNotes = true;
		state.periodic = ["day"];

		guard.refuse("day");
		expect(shown[0]!.message).toContain("core Daily Notes");
		await shown[0]!.action!.run();

		expect(state.disableCalls).toEqual(["daily-notes"]);
		expect(shown.some((entry) => entry.message.includes("now manages"))).toBe(false);
		const next = shown.at(-1)!;
		expect(next.message).toContain("Periodic Notes");
		expect(guard.refuse("day")).toBe(true);

		await next.action!.run();

		expect(state.disableCalls).toEqual(["daily-notes", "periodic-notes:day"]);
		expect(shown.at(-1)!.message).toContain("Calendaric now manages daily notes");
		expect(guard.refuse("day")).toBe(false);
	});
});
