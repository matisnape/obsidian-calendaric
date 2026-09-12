/* eslint-disable import/no-nodejs-modules -- That rule guards the BUNDLE: a
   plugin shipping node:fs breaks on Obsidian mobile and fails community review.
   This file is a test, esbuild never sees it, and two of the five criteria it
   settles are about the SHAPE of the settings screen, which means reading the
   repository's own source. Same exemption, same reason, as src/arch.test.ts. */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import CalendaricPlugin from "../main";
import { DEFAULT_SETTINGS, GRANULARITIES } from "./model";
import type { CalendaricSettings, StoredConfig } from "./model";
import { DEFAULT_PERIODIC_CONFIG } from "../types";

// US-SET-06 is about the round trip through disk, so these tests drive the real
// plugin rather than the model functions underneath it. `loadSettings` and
// `saveSettings` are the two methods Obsidian calls, and a model that behaves
// perfectly while nothing wires it to `loadData`/`saveData` would still lose
// every setting -- four modules in this repository were merged in exactly that
// state.

const root = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));

const read = (path: string): string => readFileSync(root(path), "utf8");

/** The settings screen: the one file that decides what a user can edit. */
const settingsTab = read("src/settings.ts");

// ---------------------------------------------------------------------------
// A plugin with a disk under it
// ---------------------------------------------------------------------------

interface FakeDisk {
	/** What `loadData()` would return, exactly as JSON left it. */
	data: unknown;
	/** How many times `saveData()` was called. */
	writes: number;
}

/**
 * The real plugin, with `loadData`/`saveData` standing in for Obsidian's file.
 *
 * The write goes through JSON, because that is what Obsidian's own
 * `saveData` does: a value that cannot survive being serialised must not
 * survive here either.
 */
async function loadedPlugin(initial: unknown): Promise<{ plugin: CalendaricPlugin; disk: FakeDisk }> {
	const disk: FakeDisk = { data: initial, writes: 0 };
	const plugin = new CalendaricPlugin({} as never, {} as never);
	plugin.loadData = (): Promise<unknown> => Promise.resolve(disk.data);
	plugin.saveData = (value: unknown): Promise<void> => {
		disk.data = JSON.parse(JSON.stringify(value)) as unknown;
		disk.writes += 1;
		return Promise.resolve();
	};
	await plugin.loadSettings();
	return { plugin, disk };
}

/** The group in use, as it sits on disk. */
function storedActiveSet(data: unknown): Record<string, unknown> {
	const stored = data as StoredConfig;
	const index = stored.calendarSets.findIndex((set) => set.id === stored.activeCalendarSet);
	const active = stored.calendarSets[Math.max(index, 0)];
	expect(active).toBeDefined();
	return active as unknown as Record<string, unknown>;
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Reading the settings screen
// ---------------------------------------------------------------------------

/**
 * The body of every callback the settings screen registers for a COMMITTED
 * change: a dropdown or toggle's `onChange`, and the format field's `change`
 * event. The format field's `input` event is deliberately not here -- that one
 * fires per keystroke and only redraws the example, which is not a commit.
 */
function commitHandlers(source: string): string[] {
	const bodies: string[] = [];
	const starts = /\.onChange\(|addEventListener\("change"/g;
	let match: RegExpExecArray | null;

	while ((match = starts.exec(source)) !== null) {
		const open = source.indexOf("{", match.index);
		if (open === -1) continue;

		let depth = 0;
		let end = open;
		for (; end < source.length; end++) {
			if (source[end] === "{") depth += 1;
			else if (source[end] === "}") {
				depth -= 1;
				if (depth === 0) break;
			}
		}
		bodies.push(source.slice(open, end + 1));
	}

	return bodies;
}

function uniqueMatches(source: string, pattern: RegExp): string[] {
	const found: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(source)) !== null) {
		const key = match[1];
		if (key !== undefined && !found.includes(key)) found.push(key);
	}
	return found;
}

/** Global keys the settings screen writes, e.g. `this.plugin.settings.weekStart = ...`. */
const EDITABLE_GLOBAL_KEYS = uniqueMatches(settingsTab, /this\.plugin\.settings\.(\w+)\s*=[^=]/g);

/** Per-granularity fields the screen writes, e.g. `config.folder = ...`. */
const EDITABLE_CONFIG_KEYS = uniqueMatches(settingsTab, /\bconfig\.(\w+)\s*=[^=]/g);

/**
 * Every source file the plugin actually runs, minus the three that cannot count
 * as a reader:
 *
 *   src/settings.ts        writes these keys; it is the question, not the answer
 *   src/settings/model.ts  stores them -- a default and a type guard mention
 *                          every key whether or not anything uses its value
 *   src/types.ts           declares the per-granularity shape, same reason
 *
 * Tests and the Obsidian mocks are out for the obvious reason: a key read only
 * by its own test is exactly the defect this criterion is looking for.
 */
function productionSources(): { path: string; text: string }[] {
	const excluded = ["src/settings.ts", "src/settings/model.ts", "src/types.ts"];
	const files: { path: string; text: string }[] = [];

	for (const entry of readdirSync(root("src"), { recursive: true, encoding: "utf8" })) {
		const path = `src/${entry.split("\\").join("/")}`;
		if (!path.endsWith(".ts")) continue;
		if (path.endsWith(".test.ts")) continue;
		if (path.startsWith("src/__mocks__/")) continue;
		if (excluded.includes(path)) continue;
		files.push({ path, text: read(path) });
	}

	return files;
}

/**
 * Files that READ the key's value.
 *
 * `.key` followed by `(` is a method call, not a settings read, and skipping it
 * is what keeps `moment().format(...)` -- which every date-formatting file
 * contains -- from vouching for the stored `format` field.
 */
function readersOf(key: string): string[] {
	const reads = new RegExp(`\\.${key}\\b(?!\\s*\\()`);
	return productionSources()
		.filter((file) => reads.test(file.text))
		.map((file) => file.path);
}

// ---------------------------------------------------------------------------
// AC-SET-06.1 -- a committed change is written straight away
// ---------------------------------------------------------------------------

describe("AC-SET-06.1 a committed change is persisted with no separate Save action", () => {
	it("AC-SET-06.1: every committed change on the settings screen writes the configuration", () => {
		const handlers = commitHandlers(settingsTab);

		// Nine controls plus the format field. The floor is here so a regex that
		// stops matching cannot pass this test by finding nothing to check.
		expect(handlers.length).toBeGreaterThanOrEqual(9);

		const silent = handlers.filter((body) => !body.includes("this.save()"));
		expect(silent).toEqual([]);
	});

	it("AC-SET-06.1: the screen's save path goes through the plugin's own persistence", () => {
		expect(settingsTab).toContain("await this.plugin.saveSettings();");
	});

	it("AC-SET-06.1: offers no Save control for the user to press", () => {
		expect(settingsTab).not.toMatch(/setName\(\s*["'`]Save/i);
		expect(settingsTab).not.toMatch(/setButtonText\(\s*["'`]Save/i);
	});

	it("AC-SET-06.1: one committed field change reaches the disk on its own", async () => {
		const { plugin, disk } = await loadedPlugin(null);
		expect(disk.writes).toBe(0);

		plugin.settings.day.folder = "journal/day";
		await plugin.saveSettings();

		expect(disk.writes).toBe(1);
		expect((storedActiveSet(disk.data).day as Record<string, unknown>).folder).toBe("journal/day");
	});
});

// ---------------------------------------------------------------------------
// AC-SET-06.2 -- a reload restores what was left
// ---------------------------------------------------------------------------

/** Move every editable setting off its default, so a lost one cannot hide. */
function editEverySetting(settings: CalendaricSettings): void {
	settings.weekStart = "sunday";
	settings.showWeekNumbers = false;
	settings.confirmBeforeCreate = false;
	settings.overrideLocale = "pl";

	for (const granularity of GRANULARITIES) {
		settings[granularity].enabled = true;
		settings[granularity].format = `[${granularity}]-YYYY`;
		settings[granularity].folder = `journal/${granularity}`;
		settings[granularity].templatePath = `templates/${granularity}`;
		settings[granularity].allowPrefixMatch = true;
		settings[granularity].openAtStartup = false;
	}
	settings.day.openAtStartup = true;
}

describe("AC-SET-06.2 a reload restores every setting exactly as it was left", () => {
	it("AC-SET-06.2: restores every stored setting when the plugin loads again", async () => {
		const first = await loadedPlugin(null);
		editEverySetting(first.plugin.settings);
		const asLeft = clone(first.plugin.settings);
		await first.plugin.saveSettings();

		const second = await loadedPlugin(first.disk.data);

		expect(second.plugin.settings).toEqual(asLeft);
	});

	it("AC-SET-06.2: survives a second close and reopen without drifting", async () => {
		const first = await loadedPlugin(null);
		editEverySetting(first.plugin.settings);
		const asLeft = clone(first.plugin.settings);
		await first.plugin.saveSettings();

		const second = await loadedPlugin(first.disk.data);
		await second.plugin.saveSettings();
		const third = await loadedPlugin(second.disk.data);

		expect(third.plugin.settings).toEqual(asLeft);
	});
});

// ---------------------------------------------------------------------------
// AC-SET-06.3 -- a missing field falls back to its default
// ---------------------------------------------------------------------------

describe("AC-SET-06.3 a missing field falls back to its built-in default", () => {
	/** Hand-edited down to two fields: one global, one inside one granularity. */
	const partial = {
		confirmBeforeCreate: false,
		activeCalendarSet: "Default",
		calendarSets: [{ id: "Default", day: { folder: "journal" } }],
	};

	it("AC-SET-06.3: fills every global the stored configuration never carried", async () => {
		const { plugin } = await loadedPlugin(partial);

		expect(plugin.settings.weekStart).toBe(DEFAULT_SETTINGS.weekStart);
		expect(plugin.settings.showWeekNumbers).toBe(DEFAULT_SETTINGS.showWeekNumbers);
		expect(plugin.settings.overrideLocale).toBe(DEFAULT_SETTINGS.overrideLocale);
		// The one global that WAS stored is not overwritten by its default.
		expect(plugin.settings.confirmBeforeCreate).toBe(false);
	});

	it("AC-SET-06.3: fills every missing field of a half-written granularity", async () => {
		const { plugin } = await loadedPlugin(partial);

		expect(plugin.settings.day.folder).toBe("journal");
		expect(plugin.settings.day.format).toBe(DEFAULT_PERIODIC_CONFIG.format);
		expect(plugin.settings.day.templatePath).toBe(DEFAULT_PERIODIC_CONFIG.templatePath);
		expect(plugin.settings.day.enabled).toBe(DEFAULT_PERIODIC_CONFIG.enabled);
		expect(plugin.settings.day.allowPrefixMatch).toBe(DEFAULT_PERIODIC_CONFIG.allowPrefixMatch);
		expect(plugin.settings.day.openAtStartup).toBe(DEFAULT_PERIODIC_CONFIG.openAtStartup);
	});

	it("AC-SET-06.3: finishes loading with every granularity present and complete", async () => {
		const { plugin } = await loadedPlugin(partial);

		for (const granularity of GRANULARITIES) {
			for (const field of Object.keys(DEFAULT_PERIODIC_CONFIG)) {
				expect(plugin.settings[granularity]).toHaveProperty(field);
				expect(plugin.settings[granularity][field as "format"]).toBeDefined();
			}
		}
	});

	it("AC-SET-06.3: finishes loading when there is no stored configuration at all", async () => {
		const { plugin } = await loadedPlugin(null);

		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});
});

// ---------------------------------------------------------------------------
// AC-SET-06.4 -- a field of the wrong type or shape falls back alone
// ---------------------------------------------------------------------------

describe("AC-SET-06.4 a malformed field falls back without disturbing its siblings", () => {
	/**
	 * Three globals and one granularity hand-edited into the wrong type, with
	 * well-formed siblings on either side of each of them.
	 */
	const malformed = {
		weekStart: 7,
		showWeekNumbers: "yes",
		confirmBeforeCreate: false,
		overrideLocale: "pl",
		activeCalendarSet: "Default",
		calendarSets: [
			{
				id: "Default",
				day: "garbage",
				week: { enabled: true, format: "gggg-[W]ww", folder: "journal/week" },
			},
		],
	};

	it("AC-SET-06.4: replaces a global of the wrong type with its default, one field at a time", async () => {
		const { plugin } = await loadedPlugin(malformed);

		expect(plugin.settings.weekStart).toBe(DEFAULT_SETTINGS.weekStart);
		expect(plugin.settings.showWeekNumbers).toBe(DEFAULT_SETTINGS.showWeekNumbers);
		expect(plugin.settings.confirmBeforeCreate).toBe(false);
		expect(plugin.settings.overrideLocale).toBe("pl");
	});

	it("AC-SET-06.4: replaces a granularity of the wrong shape, leaving the others as stored", async () => {
		const { plugin } = await loadedPlugin(malformed);

		expect(plugin.settings.day).toEqual(DEFAULT_PERIODIC_CONFIG);
		expect(plugin.settings.week.enabled).toBe(true);
		expect(plugin.settings.week.format).toBe("gggg-[W]ww");
		expect(plugin.settings.week.folder).toBe("journal/week");
	});

	it("AC-SET-06.4: writes a malformed granularity back as a configuration, not as its characters", async () => {
		const { plugin, disk } = await loadedPlugin(malformed);

		plugin.settings.day.enabled = true;
		await plugin.saveSettings();

		const active = storedActiveSet(disk.data);
		// "garbage" spread field-by-field would leave {"0":"g","1":"a",...} on
		// disk, which is a malformed entry the plugin wrote itself.
		expect(Object.keys(active.day as Record<string, unknown>)).toEqual(["enabled"]);
		expect(active.day).toEqual({ enabled: true });
		expect(active.week).toEqual({ enabled: true, format: "gggg-[W]ww", folder: "journal/week" });
	});

	it("AC-SET-06.4: loads a stored configuration that is not an object at all", async () => {
		for (const raw of ["nonsense", 42, [], true]) {
			const { plugin } = await loadedPlugin(raw);
			expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		}
	});

	it("AC-SET-06.4: keeps the well-formed groups when one stored group is not an object", async () => {
		const { plugin } = await loadedPlugin({
			activeCalendarSet: "Default",
			calendarSets: ["garbage", { id: "Default", day: { enabled: true, folder: "journal" } }],
		});

		expect(plugin.settings.day.folder).toBe("journal");
		expect(plugin.settings.day.enabled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC-SET-06.5 -- the audit: no stored, editable key without a reader
// ---------------------------------------------------------------------------

describe("AC-SET-06.5 every persisted, user-editable key is read by the plugin", () => {
	it("AC-SET-06.5: finds the keys the settings screen makes editable", () => {
		// The floors are what stops a regex that has stopped matching from
		// reporting an empty audit as a clean one.
		expect(EDITABLE_GLOBAL_KEYS.length).toBeGreaterThanOrEqual(4);
		expect(EDITABLE_CONFIG_KEYS.length).toBeGreaterThanOrEqual(5);
	});

	it("AC-SET-06.5: every key the screen edits is one the plugin persists", () => {
		const persistedGlobals = Object.keys(DEFAULT_SETTINGS);
		const persistedFields = Object.keys(DEFAULT_PERIODIC_CONFIG);

		expect(EDITABLE_GLOBAL_KEYS.filter((key) => !persistedGlobals.includes(key))).toEqual([]);
		expect(EDITABLE_CONFIG_KEYS.filter((key) => !persistedFields.includes(key))).toEqual([]);
	});

	it("AC-SET-06.5: every persisted, user-editable key has at least one production reader", () => {
		const unread: string[] = [];
		for (const key of EDITABLE_GLOBAL_KEYS.concat(EDITABLE_CONFIG_KEYS)) {
			if (readersOf(key).length === 0) unread.push(key);
		}

		// A key stored and shown as editable while nothing reads its value is a
		// defect in the plugin, not in this test. Report it; do not delete it.
		expect(unread).toEqual([]);
	});
});
