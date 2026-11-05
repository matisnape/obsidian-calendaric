// @vitest-environment happy-dom
//
// US-ARCH-08: docs/guide.md checked against the code it describes.
//
// Every name and every example is read out of the guide itself, and every
// answer it is held to comes from the code, so neither side is copied into a
// list here that could drift from both. The guide marks a setting or command
// name in bold (AGENTS.md: bold is a literal UI label), and an example as a
// table row of two code spans, input and output.
//
// This runs in `npm test`, which the release workflow runs, so a guide that
// names a removed setting or states a behaviour the code no longer has stops
// the release (AC-ARCH-08.5). A rename therefore cannot ship without the guide
// changing in the same change (AC-ARCH-08.4).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { CalendaricSettingsTab } from "./settings";
import { DEFAULT_SETTINGS } from "./settings/model";
import type { WeekStartOption } from "./settings/model";
import { makeSettingsTabPorts } from "./__mocks__/settingsTabPorts";
import CalendaricPlugin from "./main";
import type { Moment } from "./granularity/registry";
import { applyLocaleSettings, restoreLocale } from "./fmt/locale";
import { formatWithWeekTokens, getWeekNumber, WEEKDAY_ISO } from "./notes/noteUtils";
import { substituteTemplateTokens } from "./notes/templateTokens";
import { GRANULARITY, GRANULARITY_REGISTRY, granularityEntry } from "./granularity/registry";
import { RELEASE_GRANULARITIES } from "./types";
import type { ReleaseGranularity } from "./types";
import { COMMAND_ACTIONS, commandName, GranularityCommands } from "./commands/granularityCommands";
import type { Command } from "obsidian";
import { getMonthGrid, resolveWeekStart } from "./ui/calendarUtils";
import { calendarViewCommand } from "./ui/calendarCommand";
import { revealActiveNote, revealActiveNoteCommand } from "./commands/revealActiveNoteCommand";
import type { RevealActiveNoteDeps } from "./commands/revealActiveNoteCommand";
import { dateSwitcherCommand } from "./commands/dateSwitcherCommand";
import type { CommandAction } from "./commands/granularityCommands";
import { PeriodicNoteIndex } from "./notes/periodicNoteIndex";
import { DEFAULT_PERIODIC_CONFIG } from "./types";
import { FakeVaultPort } from "./adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "./adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "./adapters/fakeWorkspacePort";
import { DEFAULT_DAY_FORMAT } from "./settings/dailyNotesImport";

// main.ts builds its jump commands' workspace in place, with no seam to hand a
// fake in, and only main.ts imports this adapter. The command-description tests
// below put their fake workspace here.
const pluginWorkspace = vi.hoisted(() => ({ current: null as object | null }));
vi.mock("./adapters/obsidianWorkspaceAdapter", () => ({
	ObsidianWorkspaceAdapter: class {
		constructor() {
			return pluginWorkspace.current ?? {};
		}
	},
}));

const GUIDE_PATH = "docs/guide.md";
// Under happy-dom `import.meta.url` is not a file URL, so the path starts at the
// repo root, where vitest runs.
const guide = readFileSync(join(cwd(), GUIDE_PATH), "utf8");

/** "Start week on" set to `day`, through the path a saved setting takes to moment. */
const startWeekOn = (day: WeekStartOption): void => applyLocaleSettings({ overrideLocale: "en", weekStart: day }, "en");

/** The guide's prose: fenced blocks and code spans removed, since those are syntax, not labels. */
const prose = guide.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

function makeTab(desktop = { openPluginFile: (_path: string) => undefined }): CalendaricSettingsTab {
	const app = { vault: { adapter: {} } } as unknown as App;
	const settings = structuredClone(DEFAULT_SETTINGS);
	// Every group switched on, so a setting drawn only for an enabled one is drawn.
	for (const entry of GRANULARITY_REGISTRY) {
		if ("settings" in entry) settings[entry.id].enabled = true;
	}
	const plugin = {
		app,
		settings,
		saveSettings: () => Promise.resolve(),
		onSettingsChange: () => undefined,
	} as unknown as CalendaricPlugin;
	return new CalendaricSettingsTab(app, plugin, makeSettingsTabPorts(app, { desktop }));
}

/** Every name the settings tab draws: section headings, group titles and setting names. */
function settingNames(): Set<string> {
	const tab = makeTab();
	tab.display();
	const el = tab.containerEl;
	const names = [
		// A group title also holds its "Opens at startup" badge; the name is the plain span.
		...Array.from(el.querySelectorAll(".periodic-group-title > span:not(.badge)")).map((s) => s.textContent ?? ""),
		...Array.from(el.querySelectorAll(".setting-item-name:not(.periodic-group-title)")).map((n) => n.textContent ?? ""),
	];
	return new Set(names.map((name) => name.trim()).filter((name) => name !== ""));
}

/** The commands main.ts adds one by one, outside the per-group template. */
function singleCommandNames(): string[] {
	const leaves = { find: () => null } as unknown as Parameters<typeof calendarViewCommand>[0];
	const reveal = {} as unknown as Parameters<typeof revealActiveNoteCommand>[0];
	const dateSwitcher = {} as unknown as Parameters<typeof dateSwitcherCommand>[0];
	return [
		calendarViewCommand(leaves, () => Promise.resolve()).name,
		revealActiveNoteCommand(reveal).name,
		dateSwitcherCommand(dateSwitcher).name,
	];
}

function commandNames(granularities: readonly ReleaseGranularity[] = RELEASE_GRANULARITIES): Set<string> {
	return new Set([
		...singleCommandNames(),
		...granularities.flatMap((g) => COMMAND_ACTIONS.map((action) => commandName(g, action))),
	]);
}

/** The headings of the guide in order, each with the text up to the next heading. */
function sections(): { heading: string; level: number; body: string }[] {
	// A `#` line inside a fenced example is template text, not a heading of the guide.
	const parts = guide.replace(/```[\s\S]*?```/g, "").split(/^(#{1,6}) (.+)$/m);
	const out: { heading: string; level: number; body: string }[] = [];
	for (let i = 1; i < parts.length; i += 3) {
		out.push({ level: parts[i]!.length, heading: parts[i + 1]!.trim(), body: parts[i + 2] ?? "" });
	}
	return out;
}

function tables(): { header: string[]; rows: string[][] }[] {
	const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
	const out: { header: string[]; rows: string[][] }[] = [];
	for (const block of guide.split(/\n(?!\|)/).filter((b) => b.trimStart().startsWith("|"))) {
		const lines = block.trim().split("\n");
		out.push({ header: cells(lines[0]!), rows: lines.slice(2).map(cells) });
	}
	return out;
}

const CODE_SPAN = /^`([^`]+)`$/;

const DATE_RE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2} [A-Z][a-z]+ \d{4})\b/;

/**
 * The date and "Start week on" day a line of the guide names, such as
 * "Wed 15 April 2026, **Start week on** Monday". Both come from the guide, so an
 * example cannot keep its output while the week start it claims changes. The
 * date is a thunk, because a moment must be made after the week start is applied.
 */
function contextOf(text: string): { date: () => Moment; weekStart: WeekStartOption } {
	const named = new RegExp(`${DATE_RE.source}.*\\*\\*Start week on\\*\\*(?: set to)? ([A-Z][a-z]+)\\b`).exec(text);
	expect(named, `no date and Start week on day in "${text}"`).not.toBeNull();
	const [, weekday, day, start] = named!;
	const weekStart = start!.toLowerCase();
	expect(Object.keys(WEEKDAY_ISO), `"${start}" is not a day of the week`).toContain(weekStart);
	const date = () => window.moment(day, "D MMMM YYYY", "en", true);
	// A weekday that does not match its date would mislead a reader as much as a wrong output.
	expect(date().format("ddd"), `"${weekday} ${day}"`).toBe(weekday);
	return { date, weekStart: weekStart as WeekStartOption };
}

beforeEach(() => {
	window.moment.locale("en");
});

afterEach(() => {
	restoreLocale();
});

describe("the guide's names", () => {
	it("AC-ARCH-08.5, AC-ARCH-08.4: every setting or command the guide names in bold exists in the code", () => {
		const known = new Set([...settingNames(), ...commandNames()]);
		const named = [...prose.matchAll(/\*\*([^*]+)\*\*/g)].map(([, name]) => name!.trim());

		expect(named.length).toBeGreaterThan(0);
		expect(named.filter((name) => !known.has(name))).toEqual([]);
	});

	it("AC-ARCH-08.4: every command the plugin registers is one this check reads", () => {
		// commandNames() reads the single commands main.ts adds and the template
		// GranularityCommands adds per group. main.ts must add exactly as many
		// commands as singleCommandNames() builds, and no other file may call
		// addCommand, so a new command fails here until commandNames() reads it.
		const counts: Record<string, number> = {};
		for (const file of readdirSync(join(cwd(), "src"), { recursive: true, encoding: "utf8" })) {
			if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file.startsWith("__mocks__")) continue;
			const n = readFileSync(join(cwd(), "src", file), "utf8").match(/\.addCommand\(/g)?.length ?? 0;
			if (n > 0) counts[file] = n;
		}

		expect(counts).toEqual({
			"main.ts": singleCommandNames().length,
			[join("commands", "granularityCommands.ts")]: 1,
		});
	});

	it("AC-ARCH-08.4: every command the plugin registers is named in bold in the guide", () => {
		const named = new Set([...prose.matchAll(/\*\*([^*]+)\*\*/g)].map(([, name]) => name!.trim()));
		// Commands exist only for a switched-on group, and only a group with a
		// settings section can be switched on; quarter is a placeholder (DEC-23).
		const switchable = RELEASE_GRANULARITIES.filter((g) => "settings" in GRANULARITY[g]);

		expect([...commandNames(switchable)].filter((name) => !named.has(name))).toEqual([]);
	});

	it("AC-SET-08.5: the guide names the monthly and yearly groups, their settings and their commands in bold", () => {
		const named = new Set([...prose.matchAll(/\*\*([^*]+)\*\*/g)].map(([, name]) => name!.trim()));
		const expected = [
			...(["month", "year"] as const).flatMap((g) => [
				GRANULARITY[g].label,
				...COMMAND_ACTIONS.map((action) => commandName(g, action)),
			]),
			"Monthly Note Template",
			"Yearly Note Template",
		];
		// Read off the tab and the palette, so a renamed group, field or command fails here too.
		const known = new Set([...settingNames(), ...commandNames()]);
		expect(expected.filter((name) => !known.has(name))).toEqual([]);

		expect(expected.filter((name) => !named.has(name))).toEqual([]);
	});

	it("AC-ARCH-08.5: the guide quotes no name outside bold, where the check above cannot see it", () => {
		expect([...prose.matchAll(/"([^"\n]+)"/g)].map(([, quoted]) => quoted)).toEqual([]);
	});
});

describe("the guide's examples", () => {
	it("AC-ARCH-08.1: every example table row writes the filename the guide shows", () => {
		const examples = tables().filter((t) => t.rows.every((row) => row.every((cell) => CODE_SPAN.test(cell))));
		expect(examples.length).toBeGreaterThan(0);

		for (const { header, rows } of examples) {
			const context = contextOf(header[1]!);
			startWeekOn(context.weekStart);
			const date = context.date();

			const written = rows.map(([format]) => formatWithWeekTokens(format!.match(CODE_SPAN)![1]!, date, "week"));
			expect(written).toEqual(rows.map(([, output]) => output!.match(CODE_SPAN)![1]));
		}
	});

	it("AC-ARCH-08.1: the worked example writes the filename the guide shows", () => {
		const example = /^(Example, .+):\n\nFormat: `([^`]+)`\n→ Filename: `([^`]+)`/m.exec(guide);
		expect(example).not.toBeNull();
		const context = contextOf(example![1]!);
		startWeekOn(context.weekStart);

		expect(formatWithWeekTokens(example![2]!, context.date(), "week")).toBe(example![3]);
	});

	it("AC-ARCH-08.1: the week rule's worked sentences say what the code writes", () => {
		const rule = sections().find((s) => s.heading === "Which week a token reads")?.body ?? "";
		const runs = new RegExp(
			`With ([A-Z][a-z]+) as the first day, the week of ${DATE_RE.source} runs from (\\w{3} \\d{1,2}) to (\\w{3} \\d{1,2}) `,
		).exec(rule);
		const order = /With a ([A-Z][a-z]+) start, `([^`]+)` writes `([^`]+)`/.exec(rule);
		expect(runs).not.toBeNull();
		expect(order).not.toBeNull();

		const week = contextOf(`${runs![2]} ${runs![3]}, **Start week on** ${runs![1]}`);
		startWeekOn(week.weekStart);
		expect([week.date().startOf("week").format("ddd D"), week.date().endOf("week").format("ddd D")]).toEqual([
			runs![4],
			runs![5],
		]);

		const ordered = contextOf(`${runs![2]} ${runs![3]}, **Start week on** ${order![1]}`);
		startWeekOn(ordered.weekStart);
		expect(formatWithWeekTokens(order![2]!, ordered.date(), "week")).toBe(order![3]);
	});

	it("AC-ARCH-08.1: weekday tokens in the Format field are written only for weekly notes", () => {
		expect(guide).toMatch(/only evaluated for Weekly Notes/);
		startWeekOn("monday");
		const date = window.moment("2026-04-15");

		expect(formatWithWeekTokens("YYYY {{monday:DD.MM}}", date, "week")).toBe("2026 13.04");
		expect(formatWithWeekTokens("YYYY {{monday:DD.MM}}", date, "day")).toBe("2026 {{monday:DD.MM}}");
	});

	it("AC-ARCH-08.1: the Daily Notes import writes the default format the guide names", () => {
		const named = /Daily Notes import writes `([^`]+)`/.exec(guide);
		expect(named?.[1]).toBe(DEFAULT_DAY_FORMAT);
	});

	it("AC-ARCH-08.1: {{date}} writes the note's own date, not the day the note is created", () => {
		expect(guide).toMatch(/`\{\{date\}\}` \| The note's own date/);
		expect(guide).toMatch(/`\{\{date:format\}\}` \| The note's own date/);
		// A clicked calendar day is not today, so the two readings differ.
		const date = window.moment("2020-01-02");
		const config = { ...DEFAULT_SETTINGS.day, format: "YYYY-MM-DD" };

		expect(substituteTemplateTokens("{{date}} {{date:DD.MM}}", date, "day", config, "t")).toBe("2020-01-02 02.01");
	});

	it("AC-ARCH-08.1: every template variable the guide lists writes the value the guide describes", () => {
		// The value each row's description promises, for a note on Wed 15 April
		// 2026 titled "Title" with the format YYYY-MM-DD and a Monday week start.
		// A row the guide adds without a line here fails rather than going unchecked.
		const described: Record<string, RegExp> = {
			"{{date}}": /^2026-04-15$/,
			"{{date:DD}}": /^15$/,
			"{{time}}": /^\d{2}:\d{2}$/,
			"{{title}}": /^Title$/,
			"{{yesterday}}": /^2026-04-14$/,
			"{{tomorrow}}": /^2026-04-16$/,
			"{{monday:DD}}": /^13$/,
			"{{sunday:DD}}": /^19$/,
		};
		const groups: Record<string, readonly ReleaseGranularity[]> = { Universal: RELEASE_GRANULARITIES };
		for (const g of RELEASE_GRANULARITIES) groups[GRANULARITY[g].label] = [g];

		const all = sections();
		const start = all.findIndex((s) => s.heading === "Template Variables");
		const listed = all.slice(start + 1).filter((s) => s.level > all[start]!.level);
		expect(listed.length).toBeGreaterThan(0);

		startWeekOn("monday");
		const date = window.moment("2026-04-15");
		for (const { heading, body } of listed) {
			const granularities = groups[heading];
			expect(granularities, `"${heading}" names no granularity`).toBeDefined();
			const variables = [...body.matchAll(/^\| `([^|]+)` \|/gm)].flatMap(([, cell]) =>
				[...cell!.matchAll(/\{\{[^}]+\}\}/g)].map(([v]) => v.replace(":format", ":DD")),
			);
			expect(variables.length).toBeGreaterThan(0);

			for (const g of granularities!) {
				const config = { ...DEFAULT_SETTINGS[g], format: "YYYY-MM-DD" };
				for (const variable of variables) {
					expect(described, `no described value for ${variable}`).toHaveProperty([variable]);
					expect(substituteTemplateTokens(variable, date, g, config, "Title"), `${variable} in a ${g} note`).toMatch(
						described[variable]!,
					);
				}
			}
		}
		// The neighbour names come from the registry, so the guide is checked against them, not against a copy.
		expect(guide).toContain(`{{${granularityEntry("day").neighbourTokens!.previous}}}`);
	});
});

// The orchestrator's reading of AC-ARCH-08.2 (2026-11-04): a format that uses ISO
// week tokens chose ISO weeks itself (AC-FMT-03.2); every other format follows
// "Start week on". Saturday is the week start used below because it moves both the
// weekday spans and the week number away from where Monday or the "en" locale's
// Sunday would put them.
describe("week tokens and Start week on", () => {
	it("AC-ARCH-08.2: the guide states both halves of the week rule", () => {
		const rule = sections().find((s) => s.heading === "Which week a token reads")?.body ?? "";
		expect(rule).toMatch(/follow \*\*Start week on\*\*/);
		expect(rule).toMatch(/ISO week tokens \(`W`, `WW`, `GGGG`\)/);
		expect(rule).toMatch(/always start on Monday/);
		expect(rule).toMatch(/week number column \(\*\*Show week numbers\*\*\) numbers weeks the way the weekly note's \*\*Format\*\* does/);
	});

	it("AC-ARCH-08.2: a weekday token in a non-ISO format resolves inside the configured week", () => {
		startWeekOn("saturday");
		// Wed 15 April 2026 falls in the Saturday-start week Sat 11 – Fri 17 April.
		const date = window.moment("2026-04-15");

		expect(formatWithWeekTokens("gggg-[W]ww, {{saturday:DD.MM}} – {{friday:DD.MM}}", date, "week")).toBe(
			"2026-W16, 11.04 – 17.04",
		);
		expect(formatWithWeekTokens("gggg-[W]ww, {{monday:DD.MM}} – {{sunday:DD.MM}}", date, "week")).toBe(
			"2026-W16, 13.04 – 12.04",
		);
	});

	it("AC-ARCH-08.2: a weekday template token in a non-ISO weekly note resolves inside the configured week", () => {
		startWeekOn("saturday");
		const config = { ...DEFAULT_SETTINGS.week, format: "gggg-[W]ww" };

		expect(substituteTemplateTokens("{{saturday:DD.MM}}", window.moment("2026-04-15"), "week", config, "t")).toBe(
			"11.04",
		);
	});

	it("AC-ARCH-08.2: a locale week number follows the configured week start", () => {
		// Sat 11 April 2026 opens week 16 when weeks start on Saturday (week 1 is
		// Sat 27 Dec 2025 – Fri 2 Jan 2026), and sits in week 15 when they start on Monday.
		startWeekOn("saturday");
		expect(formatWithWeekTokens("gggg-[W]ww", window.moment("2026-04-11"), "week")).toBe("2026-W16");
		expect(getWeekNumber(window.moment("2026-04-11"), "gggg-[W]ww")).toBe(16);

		startWeekOn("monday");
		expect(formatWithWeekTokens("gggg-[W]ww", window.moment("2026-04-11"), "week")).toBe("2026-W15");
	});

	it("AC-ARCH-08.2: a format with ISO week tokens keeps the Monday-start ISO week", () => {
		startWeekOn("saturday");
		const date = window.moment("2026-04-15");

		// ISO week 16 of 2026 is Mon 13 – Sun 19 April, so its Saturday is the 18th.
		expect(formatWithWeekTokens("GGGG-[W]WW, {{saturday:DD.MM}}", date, "week")).toBe("2026-W16, 18.04");
		// `W` alone is an ISO token too, with no `G` beside it.
		expect(formatWithWeekTokens("[W]WW, {{saturday:DD.MM}}", date, "week")).toBe("W16, 18.04");
		// Sat 11 April 2026 is in ISO week 15 (Mon 6 – Sun 12 April), not the Saturday-start week 16.
		expect(getWeekNumber(window.moment("2026-04-11"), "[W]WW")).toBe(15);
		expect(getWeekNumber(window.moment("2026-04-11"), "GGGG-[W]WW")).toBe(15);
		const config = { ...DEFAULT_SETTINGS.week, format: "GGGG-[W]WW" };
		expect(substituteTemplateTokens("{{saturday:DD.MM}}", date, "week", config, "t")).toBe("18.04");
	});
});

describe("the guide's palette and calendar rules", () => {
	it("AC-ARCH-08.1: the palette lists next, previous and jump commands only from a note of their group", () => {
		expect(prose).toContain(
			"The palette lists the next, previous and jump commands only while the active pane holds a note of that group.",
		);

		const filed: Command[] = [];
		const host = { addCommand: (c: Command) => (filed.push(c), c), removeCommand: () => undefined };
		new GranularityCommands(host, () => undefined, () => "week").sync({ day: { enabled: true }, week: { enabled: true } });
		const listed = (c: Command) => (c.checkCallback ? c.checkCallback(true) !== false : true);
		const fromNote = /^(Open next|Open previous|Jump) /;

		// The active pane holds a weekly note: every weekly command is listed, and of
		// the daily ones only those that do not count from the active note.
		expect(filed.filter((c) => !listed(c)).map((c) => c.name)).toEqual(
			COMMAND_ACTIONS.map((a) => commandName("day", a)).filter((name) => fromNote.test(name)),
		);
		expect(filed.filter((c) => c.name.endsWith("weekly note")).every(listed)).toBe(true);
	});

	it("AC-ARCH-08.1: a calendar row's week number is the week of the row's first day", () => {
		const sentence = /With an ISO format and a (\w+) start, the row (\w{3}) (\d{1,2}) – \w{3} \d{1,2} ([A-Z][a-z]+ \d{4}) shows (\d+), although (\w{3} \d{1,2} [A-Z][a-z]+) in that row writes `([^`]+)`/;
		const match = sentence.exec(guide);
		expect(match).not.toBeNull();
		const [, day, firstWeekday, firstDate, monthYear, shown, inRow, writes] = match!;
		const year = monthYear!.split(" ")[1];

		startWeekOn(day!.toLowerCase() as WeekStartOption);
		const first = window.moment(`${firstDate} ${monthYear}`, "D MMMM YYYY", "en", true);
		const inRowDate = window.moment(`${inRow} ${year}`, "ddd D MMMM YYYY", "en", true);
		const row = getMonthGrid(first, resolveWeekStart(day!.toLowerCase() as WeekStartOption), "GGGG-[W]WW").find(
			(week) => week.days.some((d) => d.date.isSame(inRowDate, "day")),
		);

		expect(row?.days[0]?.date.format("ddd D")).toBe(`${firstWeekday} ${firstDate}`);
		expect(row?.weekNumber).toBe(Number(shown));
		expect(formatWithWeekTokens("GGGG-[W]WW", inRowDate, "week")).toBe(writes);
	});
});

// Each "What it does" sentence of the Commands section is matched word for word,
// then held to what the command's code does, so neither can change alone.
describe("the guide's command descriptions", () => {
	/** The "What it does" cell of the Commands row that names `command` in bold. */
	function describes(command: string): string {
		const row = tables()
			.flatMap((t) => (t.header[0] === "Command" ? t.rows : []))
			.find((cells) => cells[0]!.includes(`**${command}**`));
		expect(row, `no Commands row names **${command}**`).toBeDefined();
		return row![1]!;
	}

	const DAY = { ...DEFAULT_PERIODIC_CONFIG, enabled: true, format: "YYYY-MM-DD", folder: "Daily" };

	/** A daily-notes vault holding `paths`, with `active` in the active pane. */
	function world(active: string | null, ...paths: string[]) {
		const vault = new FakeVaultPort();
		for (const path of paths) vault.seedFile(path, "");
		const vaultConfig = new FakeVaultConfigPort("");
		const workspace = new FakeWorkspacePort();
		const index = new PeriodicNoteIndex(vault, vaultConfig, { day: DAY });
		const ports = { vault, vaultConfig, workspace };
		const notes = () => vault.listNotes().map((f) => f.path).sort();
		const opened = () => workspace.opened.map(({ file }) => file.path);
		return { active, vault, workspace, index, ports, notes, opened };
	}

	/** Run one generated command the way the palette does, through the plugin. */
	async function runCommand(w: ReturnType<typeof world>, action: CommandAction): Promise<void> {
		const instance = new CalendaricPlugin({} as never, {} as never);
		const view = w.active === null ? null : { file: { path: w.active } };
		pluginWorkspace.current = w.workspace;
		Object.assign(instance, {
			app: { workspace: { getActiveViewOfType: () => view } },
			loadData: () => Promise.resolve(null),
			index: w.index,
			notePorts: () => w.ports,
		});
		await instance.loadSettings();
		instance.settings.day = { ...instance.settings.day, ...DAY };
		const plugin = instance as unknown as { runGranularityCommand(g: ReleaseGranularity, a: CommandAction): Promise<void> };
		await plugin.runGranularityCommand("day", action);
	}

	afterEach(() => {
		vi.useRealTimers();
		pluginWorkspace.current = null;
	});

	it("AC-ARCH-08.1: Open calendar opens the view and is left out of the palette while the view is on screen", () => {
		expect(describes("Open calendar")).toBe(
			"Opens the calendar view. The palette leaves it out while the calendar is already on screen.",
		);

		let visible = true;
		const open = vi.fn(() => Promise.resolve());
		const command = calendarViewCommand({ find: () => ({ isVisible: () => visible }) } as never, open);

		expect(command.checkCallback!(true)).toBe(false);
		visible = false;
		expect(command.checkCallback!(true)).toBe(true);
		command.checkCallback!(false);
		expect(open).toHaveBeenCalledOnce();
	});

	it("AC-ARCH-08.1: Reveal active note shows a daily or weekly note's period, and no other note's", async () => {
		expect(describes("Reveal active note")).toBe(
			"Shows the period of the daily or weekly note in the active pane in the calendar.",
		);

		const revealed: string[] = [];
		for (const granularity of RELEASE_GRANULARITIES) {
			const deps: RevealActiveNoteDeps = {
				activePath: () => "note.md",
				resolve: () => ({ granularity }) as never,
				open: () => Promise.resolve(),
				view: () => ({ revealActiveNote: () => void revealed.push(granularity) }),
				notify: () => undefined,
			};
			await revealActiveNote(deps);
		}

		expect(revealed).toEqual(["day", "week"]);
	});

	it("AC-ARCH-08.1: Open current opens today's note, writing it first when the vault has none", async () => {
		expect(describes("Open current daily note")).toBe(
			"Opens the note for the period that holds today, creating it first when the vault has none.",
		);
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 3, 15, 12));

		const empty = world(null);
		await runCommand(empty, "open-current");
		expect(empty.notes()).toEqual(["Daily/2026-04-15.md"]);
		expect(empty.opened()).toEqual(["Daily/2026-04-15.md"]);

		const kept = world(null);
		kept.vault.seedFile("Daily/2026-04-15.md", "kept");
		await runCommand(kept, "open-current");
		expect(kept.notes()).toEqual(["Daily/2026-04-15.md"]);
		expect(kept.vault.contentAt("Daily/2026-04-15.md")).toBe("kept");
		expect(kept.opened()).toEqual(["Daily/2026-04-15.md"]);
	});

	it("AC-ARCH-08.1: Open next and Open previous count from the active note, writing the note when missing", async () => {
		expect(describes("Open next daily note")).toBe(
			"Opens the note for the period after the note in the active pane, creating it first when the vault has none.",
		);
		expect(describes("Open previous daily note")).toBe("The same, for the period before.");
		// Today is far from the active note, so a count from today would land elsewhere.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 3, 15, 12));

		const w = world("Daily/2020-01-06.md", "Daily/2020-01-06.md");
		await runCommand(w, "open-next");
		await runCommand(w, "open-previous");

		expect(w.opened()).toEqual(["Daily/2020-01-07.md", "Daily/2020-01-05.md"]);
		expect(w.notes()).toEqual(["Daily/2020-01-05.md", "Daily/2020-01-06.md", "Daily/2020-01-07.md"]);
	});

	it("AC-ARCH-08.1: the jumps open the closest existing note either side of the active one and never write one", async () => {
		expect(describes("Jump forward to next existing daily note")).toBe(
			"Opens the closest existing note after the one in the active pane. It never creates a note.",
		);
		expect(describes("Jump backward to previous existing daily note")).toBe(
			"The same, before the one in the active pane.",
		);

		const w = world("Daily/2020-01-06.md", "Daily/2020-01-01.md", "Daily/2020-01-06.md", "Daily/2020-01-09.md");
		const before = w.notes();
		await runCommand(w, "jump-forward");
		await runCommand(w, "jump-backward");
		// Past the last note there is nothing to open, and nothing is written in its place.
		w.active = "Daily/2020-01-09.md";
		await runCommand(w, "jump-forward");

		expect(w.opened()).toEqual(["Daily/2020-01-09.md", "Daily/2020-01-01.md"]);
		expect(w.notes()).toEqual(before);
	});
});

describe("opening the guide from the settings", () => {
	function guideLink(desktop?: { openPluginFile: (path: string) => undefined }): {
		link: HTMLAnchorElement;
		container: HTMLElement;
	} {
		const tab = makeTab(desktop);
		tab.display();
		const link = Array.from(tab.containerEl.querySelectorAll("a")).find(
			(a) => a.textContent === "Format & template guide",
		);
		expect(link).toBeDefined();
		return { link: link as HTMLAnchorElement, container: tab.containerEl };
	}

	it("AC-ARCH-08.3: the settings link opens the published guide this test reads", () => {
		const { link } = guideLink();

		expect(link.getAttribute("href")).toMatch(new RegExp(`^https://github\\.com/[^/]+/[^/]+/blob/master/${GUIDE_PATH}$`));
		expect(link.getAttribute("target")).toBe("_blank");
	});

	it("AC-ARCH-08.3: clicking the link leaves it to the browser, with no desktop-only capability", () => {
		// manifest.json is desktop-only today (DEC-24). The link is a plain web
		// link anyway, so it keeps working on a phone if mobile support is ever
		// declared; what must not happen is the click reaching the desktop shell,
		// or a handler cancelling the link's own navigation.
		const openPluginFile = vi.fn((_path: string) => undefined);
		const { link, container } = guideLink({ openPluginFile });
		let cancelledByPlugin: boolean | null = null;
		// The tab is detached, so its own root is the last element the click
		// bubbles through. Cancelling there stops happy-dom from opening the page;
		// its window.open is on an internal window that vi.spyOn(window) cannot reach.
		container.addEventListener("click", (event) => {
			cancelledByPlugin = event.defaultPrevented;
			event.preventDefault();
		});

		link.click();

		expect(cancelledByPlugin).toBe(false);
		expect(openPluginFile).not.toHaveBeenCalled();
	});
});
