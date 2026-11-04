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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { CalendaricSettingsTab } from "./settings";
import { DEFAULT_SETTINGS } from "./settings/model";
import type { WeekStartOption } from "./settings/model";
import { makeSettingsTabPorts } from "./__mocks__/settingsTabPorts";
import type CalendaricPlugin from "./main";
import { applyLocale, restoreLocale } from "./fmt/locale";
import { formatWithWeekTokens } from "./notes/noteUtils";
import { substituteTemplateTokens } from "./notes/templateTokens";
import { GRANULARITY, GRANULARITY_REGISTRY, granularityEntry } from "./granularity/registry";
import { RELEASE_GRANULARITIES } from "./types";
import type { ReleaseGranularity } from "./types";
import { COMMAND_ACTIONS, commandName } from "./commands/granularityCommands";
import { calendarViewCommand } from "./ui/calendarCommand";
import { revealActiveNoteCommand } from "./commands/revealActiveNoteCommand";
import { DEFAULT_DAY_FORMAT } from "./settings/dailyNotesImport";

const GUIDE_PATH = "docs/guide.md";
// Under happy-dom `import.meta.url` is not a file URL, so paths start at the
// repo root, where vitest runs.
const readRepoFile = (path: string): string => readFileSync(join(cwd(), path), "utf8");
const guide = readRepoFile(GUIDE_PATH);
const manifest = JSON.parse(readRepoFile("manifest.json")) as {
	isDesktopOnly: boolean;
};

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
		...Array.from(el.querySelectorAll("h2")).map((h) => h.textContent ?? ""),
		// A group title also holds its "Opens at startup" badge; the name is the plain span.
		...Array.from(el.querySelectorAll(".periodic-group-title > span:not(.badge)")).map((s) => s.textContent ?? ""),
		...Array.from(el.querySelectorAll(".setting-item-name:not(.periodic-group-title)")).map((n) => n.textContent ?? ""),
	];
	return new Set(names.map((name) => name.trim()).filter((name) => name !== ""));
}

function commandNames(): Set<string> {
	const leaves = { find: () => null } as unknown as Parameters<typeof calendarViewCommand>[0];
	const reveal = {} as unknown as Parameters<typeof revealActiveNoteCommand>[0];
	return new Set([
		calendarViewCommand(leaves, () => Promise.resolve()).name,
		revealActiveNoteCommand(reveal).name,
		...RELEASE_GRANULARITIES.flatMap((g) => COMMAND_ACTIONS.map((action) => commandName(g, action))),
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

/**
 * The date and "Start week on" each example table's output column is written
 * for, keyed by that column's header. A new example table needs a line here,
 * or the test below fails on it rather than skipping it.
 */
const EXAMPLE_CONTEXTS: Record<string, { date: string; weekStart: WeekStartOption }> = {
	"Example output (Mon 13 April 2026)": { date: "2026-04-13", weekStart: "monday" },
	"Week of 13–19 April 2026, **Start week on** Monday": { date: "2026-04-15", weekStart: "monday" },
	"Filename for Wed 15 April 2026, **Start week on** Saturday": { date: "2026-04-15", weekStart: "saturday" },
};

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

	it("AC-ARCH-08.5: the guide quotes no name outside bold, where the check above cannot see it", () => {
		expect([...prose.matchAll(/"([^"\n]+)"/g)].map(([, quoted]) => quoted)).toEqual([]);
	});
});

describe("the guide's examples", () => {
	it("AC-ARCH-08.1: every example table row writes the filename the guide shows", () => {
		const examples = tables().filter((t) => t.rows.every((row) => row.every((cell) => CODE_SPAN.test(cell))));
		expect(examples.length).toBeGreaterThan(0);

		for (const { header, rows } of examples) {
			const context = EXAMPLE_CONTEXTS[header[1]!];
			expect(context, `no date or week start for the example table "${header[1]}"`).toBeDefined();
			applyLocale("en", context!.weekStart, "en");
			const date = window.moment(context!.date);

			const written = rows.map(([format]) => formatWithWeekTokens(format!.match(CODE_SPAN)![1]!, date, "week"));
			expect(written).toEqual(rows.map(([, output]) => output!.match(CODE_SPAN)![1]));
		}
	});

	it("AC-ARCH-08.1: the worked example writes the filename the guide shows", () => {
		const example = /Format: `([^`]+)`\n→ Filename: `([^`]+)`/.exec(guide);
		expect(example).not.toBeNull();
		applyLocale("en", "monday", "en");

		expect(formatWithWeekTokens(example![1]!, window.moment("2026-04-15"), "week")).toBe(example![2]);
	});

	it("AC-ARCH-08.1: weekday tokens in the Format field are written only for weekly notes", () => {
		expect(guide).toMatch(/only evaluated for Weekly Notes/);
		applyLocale("en", "monday", "en");
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

	it("AC-ARCH-08.1: every template variable the guide lists is replaced in a note of its group", () => {
		const groups: Record<string, readonly ReleaseGranularity[]> = { Universal: RELEASE_GRANULARITIES };
		for (const g of RELEASE_GRANULARITIES) groups[GRANULARITY[g].label] = [g];

		const all = sections();
		const start = all.findIndex((s) => s.heading === "Template Variables");
		const listed = all.slice(start + 1).filter((s) => s.level > all[start]!.level);
		expect(listed.length).toBeGreaterThan(0);

		applyLocale("en", "monday", "en");
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
					expect(substituteTemplateTokens(variable, date, g, config, "Title"), `${variable} in a ${g} note`).not.toMatch(
						/\{\{/,
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
	});

	it("AC-ARCH-08.2: a weekday token in a non-ISO format resolves inside the configured week", () => {
		applyLocale("en", "saturday", "en");
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
		applyLocale("en", "saturday", "en");
		const config = { ...DEFAULT_SETTINGS.week, format: "gggg-[W]ww" };

		expect(substituteTemplateTokens("{{saturday:DD.MM}}", window.moment("2026-04-15"), "week", config, "t")).toBe(
			"11.04",
		);
	});

	it("AC-ARCH-08.2: a locale week number follows the configured week start", () => {
		// Sat 11 April 2026 opens week 16 when weeks start on Saturday (week 1 is
		// Sat 27 Dec 2025 – Fri 2 Jan 2026), and sits in week 15 when they start on Monday.
		applyLocale("en", "saturday", "en");
		expect(formatWithWeekTokens("gggg-[W]ww", window.moment("2026-04-11"), "week")).toBe("2026-W16");

		applyLocale("en", "monday", "en");
		expect(formatWithWeekTokens("gggg-[W]ww", window.moment("2026-04-11"), "week")).toBe("2026-W15");
	});

	it("AC-ARCH-08.2: a format with ISO week tokens keeps the Monday-start ISO week", () => {
		applyLocale("en", "saturday", "en");
		const date = window.moment("2026-04-15");

		// ISO week 16 of 2026 is Mon 13 – Sun 19 April, so its Saturday is the 18th.
		expect(formatWithWeekTokens("GGGG-[W]WW, {{saturday:DD.MM}}", date, "week")).toBe("2026-W16, 18.04");
		const config = { ...DEFAULT_SETTINGS.week, format: "GGGG-[W]WW" };
		expect(substituteTemplateTokens("{{saturday:DD.MM}}", date, "week", config, "t")).toBe("18.04");
	});
});

describe("opening the guide from the settings", () => {
	function guideLink(desktop?: { openPluginFile: (path: string) => undefined }): HTMLAnchorElement {
		const tab = makeTab(desktop);
		tab.display();
		const link = Array.from(tab.containerEl.querySelectorAll("a")).find(
			(a) => a.textContent === "Format & template guide",
		);
		expect(link).toBeDefined();
		return link as HTMLAnchorElement;
	}

	it("AC-ARCH-08.3: the settings link opens the published guide this test reads", () => {
		const link = guideLink();

		expect(link.getAttribute("href")).toMatch(new RegExp(`^https://github\\.com/[^/]+/[^/]+/blob/master/${GUIDE_PATH}$`));
		expect(link.getAttribute("target")).toBe("_blank");
	});

	it("AC-ARCH-08.3: opening the guide uses no desktop-only capability", () => {
		// The manifest is desktop-only today (DEC-24). The link is a plain web
		// link anyway, so it keeps working on a phone if mobile support is ever
		// declared; what must not happen is the click reaching the desktop shell.
		expect(manifest.isDesktopOnly).toBe(true);
		const openPluginFile = vi.fn((_path: string) => undefined);
		const link = guideLink({ openPluginFile });
		document.addEventListener("click", (event) => event.preventDefault(), { once: true });

		link.click();

		expect(openPluginFile).not.toHaveBeenCalled();
	});
});
