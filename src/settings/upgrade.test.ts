import { describe, it, expect, vi, beforeEach } from "vitest";
import CalendaricPlugin from "../main";
import { DEFAULT_SETTINGS, GRANULARITIES } from "./model";
import type { StoredConfig } from "./model";
import { CONFIG_VERSION } from "./upgrade";

// US-MIG-07 drives the real plugin, like persistence.test.ts: the upgrade only
// counts if `loadSettings` is what runs it and `saveData` is what keeps it.

const notices = vi.hoisted((): string[] => []);

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	class RecordedNotice {
		constructor(message: string) {
			notices.push(message);
		}
	}
	return { ...actual, Notice: RecordedNotice };
});

beforeEach(() => {
	notices.length = 0;
});

interface FakeDisk {
	/** What `loadData()` hands back; a function stands in for a load that throws. */
	data: unknown;
	writes: number;
}

async function loadedPlugin(disk: FakeDisk): Promise<CalendaricPlugin> {
	const plugin = new CalendaricPlugin({} as never, {} as never);
	plugin.loadData = (): Promise<unknown> =>
		typeof disk.data === "function" ? Promise.reject((disk.data as () => Error)()) : Promise.resolve(disk.data);
	plugin.saveData = (value: unknown): Promise<void> => {
		disk.data = JSON.parse(JSON.stringify(value)) as unknown;
		disk.writes += 1;
		return Promise.resolve();
	};
	await plugin.loadSettings();
	return plugin;
}

function onDisk(data: unknown): FakeDisk {
	return { data: JSON.parse(JSON.stringify(data)) as unknown, writes: 0 };
}

function activeGroup(data: unknown): Record<string, unknown> {
	const stored = data as StoredConfig;
	const index = stored.calendarSets.findIndex((set) => set.id === stored.activeCalendarSet);
	return stored.calendarSets[Math.max(index, 0)] as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The shapes Calendaric has saved before this one
// ---------------------------------------------------------------------------

/**
 * Before US-SET-01 (`git show e7f3e11^:src/settings.ts`): the granularities sat
 * at the top level, and `saveData` wrote the whole object, so every field of
 * `DEFAULT_SETTINGS` was on disk. Copied verbatim, then moved off every default.
 */
const OLD_PERIODIC_DEFAULT = { enabled: false, format: "", folder: "", templatePath: "", openAtStartup: false };
const OLD_DEFAULTS = {
	weekStart: "monday",
	showWeekNumbers: true,
	confirmBeforeCreate: true,
	overrideLocale: "",
	hasMigratedDailyNoteSettings: false,
	day: { ...OLD_PERIODIC_DEFAULT, enabled: true },
	week: { ...OLD_PERIODIC_DEFAULT, enabled: true },
	month: { ...OLD_PERIODIC_DEFAULT },
	quarter: { ...OLD_PERIODIC_DEFAULT },
	year: { ...OLD_PERIODIC_DEFAULT },
};

function editedFlatFile(): Record<string, unknown> {
	const file: Record<string, unknown> = {
		...OLD_DEFAULTS,
		weekStart: "sunday",
		showWeekNumbers: false,
		confirmBeforeCreate: false,
		overrideLocale: "pl",
		hasMigratedDailyNoteSettings: true,
	};
	for (const granularity of GRANULARITIES) {
		const old = OLD_DEFAULTS[granularity];
		file[granularity] = {
			// Every toggle flipped from its old default, so a default cannot pass for it.
			enabled: !old.enabled,
			format: `[${granularity}]-YYYY`,
			folder: `journal/${granularity}`,
			templatePath: `templates/${granularity}.md`,
			openAtStartup: granularity === "week",
		};
	}
	return file;
}

describe("AC-MIG-07.1 an older stored shape loads into the current one with nothing lost", () => {
	it("AC-MIG-07.1: a file with the granularities at the top level keeps every folder, format, template and toggle", async () => {
		const file = editedFlatFile();
		const plugin = await loadedPlugin(onDisk(file));

		for (const granularity of GRANULARITIES) {
			const old = file[granularity] as Record<string, unknown>;
			expect(plugin.settings[granularity]).toMatchObject(old);
		}
		expect(plugin.settings.weekStart).toBe("sunday");
		expect(plugin.settings.showWeekNumbers).toBe(false);
		expect(plugin.settings.confirmBeforeCreate).toBe(false);
		expect(plugin.settings.overrideLocale).toBe("pl");
		expect(plugin.settings.hasMigratedDailyNoteSettings).toBe(true);
	});

	it("AC-MIG-07.1: the upgraded file is saved in the current shape and reloads the same", async () => {
		const file = editedFlatFile();
		const disk = onDisk(file);
		const first = await loadedPlugin(disk);
		await first.saveSettings();

		const saved = disk.data as Record<string, unknown>;
		for (const granularity of GRANULARITIES) {
			expect(saved).not.toHaveProperty(granularity);
			expect(activeGroup(saved)[granularity]).toMatchObject(file[granularity] as object);
		}
		expect(saved.configVersion).toBe(CONFIG_VERSION);

		const second = await loadedPlugin(disk);
		expect(second.settings).toEqual(first.settings);
	});

	it("AC-MIG-07.1: a grouped file still carrying the old top-level entries keeps the group's edits and the old values", async () => {
		// What a build between US-SET-01 and this story leaves behind: it read
		// the flat file into a fresh default group, saved that group with one
		// edit, and carried the unread top-level entries along.
		const file = editedFlatFile();
		const freshGroup: Record<string, unknown> = { id: "Default" };
		for (const granularity of GRANULARITIES) freshGroup[granularity] = { ...DEFAULT_SETTINGS[granularity] };
		(freshGroup.month as Record<string, unknown>).folder = "edited/after-groups";
		const plugin = await loadedPlugin(onDisk({ ...file, activeCalendarSet: "Default", calendarSets: [freshGroup] }));

		expect(plugin.settings.month.folder).toBe("edited/after-groups");
		expect(plugin.settings.month.format).toBe("[month]-YYYY");
		expect(plugin.settings.day.enabled).toBe(false);
		expect(plugin.settings.day.templatePath).toBe("templates/day.md");
	});

	it("AC-MIG-07.1: a file from before the granularities existed keeps its week settings", async () => {
		// `git show 00d4ff4:src/settings.ts`: weekStart and showWeekNumbers only.
		const plugin = await loadedPlugin(onDisk({ weekStart: "saturday", showWeekNumbers: false }));

		expect(plugin.settings.weekStart).toBe("saturday");
		expect(plugin.settings.showWeekNumbers).toBe(false);
		for (const granularity of GRANULARITIES) expect(plugin.settings[granularity]).toEqual(DEFAULT_SETTINGS[granularity]);
	});
});

describe("AC-MIG-07.2 a file from a newer version loads and keeps what it does not understand", () => {
	const newer = {
		configVersion: CONFIG_VERSION + 5,
		weekStart: "fortnightly",
		showWeekNumbers: false,
		futureGlobal: { theme: "dark" },
		activeCalendarSet: "Work",
		calendarSets: [
			{
				id: "Work",
				futureGroupField: 3,
				day: { enabled: true, folder: "work/day", colour: "teal" },
				decade: { enabled: true, folder: "work/decade" },
			},
		],
	};

	it("AC-MIG-07.2: starts with what it understands and a default for what it cannot interpret", async () => {
		const plugin = await loadedPlugin(onDisk(newer));

		expect(plugin.settings.day.folder).toBe("work/day");
		expect(plugin.settings.day.enabled).toBe(true);
		expect(plugin.settings.showWeekNumbers).toBe(false);
		expect(plugin.settings.weekStart).toBe(DEFAULT_SETTINGS.weekStart);
	});

	it("AC-MIG-07.2: every field it does not recognise, and the newer marker, survive a save", async () => {
		const disk = onDisk(newer);
		const plugin = await loadedPlugin(disk);
		expect(disk.writes).toBe(0);

		plugin.settings.day.folder = "work/days";
		await plugin.saveSettings();

		const saved = disk.data as Record<string, unknown>;
		expect(saved.configVersion).toBe(CONFIG_VERSION + 5);
		expect(saved.futureGlobal).toEqual({ theme: "dark" });
		const group = activeGroup(saved);
		expect(group.futureGroupField).toBe(3);
		expect(group.decade).toEqual({ enabled: true, folder: "work/decade" });
		expect(group.day).toEqual({ enabled: true, folder: "work/days", colour: "teal" });
	});
});

describe("AC-MIG-07.3 an unreadable file or field falls back, says so once, and the plugin loads", () => {
	const NOTICE = /some settings could not be read and were reset/i;

	it("AC-MIG-07.3: a file that is not valid JSON loads the defaults and shows one notice", async () => {
		// Obsidian 1.15's readJson logs a JSON.parse failure and resolves undefined.
		const disk = onDisk(null);
		disk.data = undefined;
		const plugin = await loadedPlugin(disk);

		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatch(NOTICE);
		// Writing the defaults now would destroy a file the user can still repair.
		expect(disk.writes).toBe(0);
	});

	it("AC-MIG-07.3: a load that throws loads the defaults and shows one notice", async () => {
		const disk: FakeDisk = { data: () => new SyntaxError("Unexpected token } in JSON"), writes: 0 };
		const plugin = await loadedPlugin(disk);

		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatch(NOTICE);
	});

	it("AC-MIG-07.3: a folder holding a number resets that field alone, with one notice", async () => {
		const plugin = await loadedPlugin(
			onDisk({
				configVersion: CONFIG_VERSION,
				weekStart: "sunday",
				activeCalendarSet: "Default",
				calendarSets: [
					{
						id: "Default",
						day: { enabled: true, folder: 42, format: "YYYY/MM/DD" },
						week: { enabled: true, folder: "journal/week" },
					},
				],
			}),
		);

		expect(plugin.settings.day.folder).toBe(DEFAULT_SETTINGS.day.folder);
		expect(plugin.settings.day.format).toBe("YYYY/MM/DD");
		expect(plugin.settings.day.enabled).toBe(true);
		expect(plugin.settings.week.folder).toBe("journal/week");
		expect(plugin.settings.weekStart).toBe("sunday");
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatch(NOTICE);
	});

	it("AC-MIG-07.3: a global of the wrong type is reported too", async () => {
		await loadedPlugin(onDisk({ showWeekNumbers: "yes", activeCalendarSet: "Default", calendarSets: [{ id: "Default" }] }));

		expect(notices).toHaveLength(1);
	});

	it("AC-MIG-07.3: a missing file, a missing field or an upgrade shows no notice", async () => {
		await loadedPlugin(onDisk(null));
		await loadedPlugin(onDisk({ activeCalendarSet: "Default", calendarSets: [{ id: "Default", day: { folder: "j" } }] }));
		await loadedPlugin(onDisk(editedFlatFile()));

		expect(notices).toEqual([]);
	});
});

describe("AC-MIG-07.4 an upgraded file is not upgraded again", () => {
	it("AC-MIG-07.4: the upgrade writes once, and a second open writes nothing", async () => {
		const disk = onDisk(editedFlatFile());
		await loadedPlugin(disk);
		expect(disk.writes).toBe(1);
		const afterUpgrade = JSON.stringify(disk.data);

		await loadedPlugin(disk);

		expect(disk.writes).toBe(1);
		expect(JSON.stringify(disk.data)).toBe(afterUpgrade);
	});

	it("AC-MIG-07.4: a file already in the current shape is not rewritten on open", async () => {
		const disk = onDisk({ activeCalendarSet: "Default", calendarSets: [{ id: "Default", day: { folder: "j" } }] });
		await loadedPlugin(disk);

		expect(disk.writes).toBe(0);
	});
});
