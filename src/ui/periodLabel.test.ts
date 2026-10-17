// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { humanizePeriod, PeriodLabels } from "./periodLabel";
import type { LabelLeaf, LabelledFile } from "./periodLabel";
import CalendaricPlugin from "../main";
import { MarkdownView } from "obsidian";
import { restoreLocale } from "../fmt/locale";
import { applySettings, defaultStoredConfig, toSettings } from "../settings/model";
import type { StoredConfig } from "../settings/model";
import { PeriodicNoteIndex } from "../notes/periodicNoteIndex";
import type { PeriodicConfigs } from "../notes/periodicNoteIndex";
import type { PeriodNotePorts } from "../notes/periodNoteOpen";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";

// The shared mock carries neither; the wiring test below needs both.
vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	MarkdownView: class MarkdownView {},
	getLanguage: () => "en",
}));

type Moment = ReturnType<typeof window.moment>;

const NOW = "2026-09-24T15:30:00";
const now = (): Moment => window.moment(NOW);
const at = (date: string): Moment => window.moment(date);

describe("humanizePeriod", () => {
	it("AC-CAL-13.1: names the period in words, such as Today or Last week", () => {
		expect(humanizePeriod("day", at("2026-09-24"), now())).toBe("Today");
		expect(humanizePeriod("day", at("2026-09-23"), now())).toBe("Yesterday");
		expect(humanizePeriod("day", at("2026-09-25"), now())).toBe("Tomorrow");
		expect(humanizePeriod("week", at("2026-09-14"), now())).toBe("Last week");
		expect(humanizePeriod("week", at("2026-09-21"), now())).toBe("This week");
		expect(humanizePeriod("month", at("2026-10-01"), now())).toBe("Next month");
		expect(humanizePeriod("year", at("2026-01-01"), now())).toBe("This year");
	});

	it("AC-CAL-13.1: the label follows the note's own date, not the current date", () => {
		expect(humanizePeriod("day", at("2026-09-21"), now())).toBe("3 days ago");
		expect(humanizePeriod("week", at("2026-08-31"), now())).toBe("3 weeks ago");
		expect(humanizePeriod("month", at("2027-01-01"), now())).toBe("in 4 months");
		expect(humanizePeriod("year", at("2024-01-01"), now())).toBe("2 years ago");
	});

	it("AC-CAL-13.1: a week is the one the weekly format numbers, not the locale's", () => {
		// Sunday 2026-09-20 under the Sunday-start "en" locale: ISO still puts it in W38.
		const sunday = at("2026-09-20T12:00:00");
		const w38 = at("2026-09-14");
		const w39 = at("2026-09-21");

		expect(humanizePeriod("week", w38, sunday, "GGGG-[W]WW")).toBe("This week");
		expect(humanizePeriod("week", w39, sunday, "GGGG-[W]WW")).toBe("Next week");
		expect(humanizePeriod("week", w38, sunday, "gggg-[W]ww")).toBe("Last week");
		expect(humanizePeriod("week", w39, sunday, "gggg-[W]ww")).toBe("This week");
	});
});

function leaf(path: string | null): LabelLeaf {
	const contentEl = document.createElement("div");
	contentEl.createDiv({ cls: "markdown-source-view", text: "# The note's own text" });
	return { file: path === null ? null : { path }, contentEl };
}

const FILES: Record<string, LabelledFile> = {
	"2026-09-24.md": { granularity: "day", date: at("2026-09-24"), prefixMatch: false },
	"2026-09-23 standup.md": { granularity: "day", date: at("2026-09-23"), prefixMatch: true },
	"2026-W38.md": { granularity: "week", date: at("2026-09-14"), prefixMatch: false },
};

function manager(leaves: LabelLeaf[], state = { enabled: true, now: NOW, dayEnabled: true }) {
	const opened: string[] = [];
	const labels = new PeriodLabels({
		leaves: () => leaves,
		enabled: () => state.enabled,
		resolve: (path) => FILES[path] ?? null,
		now: () => window.moment(state.now),
		weekFormat: () => "gggg-[W]ww",
		// The "en" locale's own start, as the plugin keeps the two equal.
		weekStart: () => 0,
		dayEnabled: () => state.dayEnabled,
		openDay: (date) => {
			opened.push(date.format("YYYY-MM-DD"));
			return Promise.resolve();
		},
	});
	return { labels, state, opened };
}

const labelOf = (l: LabelLeaf) => l.contentEl.querySelector(".calendaric-period-label");
const toggleOf = (l: LabelLeaf) => l.contentEl.querySelector<HTMLElement>(".calendaric-day-strip-toggle");
const stripOf = (l: LabelLeaf) => l.contentEl.querySelector(".calendaric-day-strip");
const dayButtons = (l: LabelLeaf) => Array.from(l.contentEl.querySelectorAll<HTMLButtonElement>(".calendaric-day-strip-day"));
const dayButton = (l: LabelLeaf, date: string) =>
	l.contentEl.querySelector<HTMLButtonElement>(`.calendaric-day-strip-day[data-date="${date}"]`);
const press = (el: HTMLElement, key: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

describe("the day strip", () => {
	it("AC-CAL-14.1: activating the label shows the seven days of the note's week, from the configured start", () => {
		const daily = leaf("2026-09-24.md");
		manager([daily]).labels.sync();
		expect(stripOf(daily)).toBeNull();

		toggleOf(daily)?.click();

		expect(dayButtons(daily).map((b) => b.dataset.date)).toEqual([
			"2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26",
		]);
		expect(toggleOf(daily)?.getAttribute("aria-expanded")).toBe("true");

		toggleOf(daily)?.click();
		expect(stripOf(daily)).toBeNull();
	});

	it("AC-CAL-14.1: Enter and Space on the focused label toggle the strip too", () => {
		const weekly = leaf("2026-W38.md");
		manager([weekly]).labels.sync();
		const toggle = toggleOf(weekly);
		expect(toggle?.getAttribute("tabindex")).toBe("0");
		expect(toggle?.getAttribute("role")).toBe("button");

		press(toggle as HTMLElement, "Enter");
		expect(dayButtons(weekly)).toHaveLength(7);
		press(toggle as HTMLElement, " ");
		expect(stripOf(weekly)).toBeNull();
	});

	it("AC-CAL-14.1: the daily note's own day and today are marked", () => {
		const yesterday = leaf("2026-09-23 standup.md");
		manager([yesterday]).labels.sync();
		toggleOf(yesterday)?.click();

		const markedWith = (cls: string) => dayButtons(yesterday).filter((b) => b.classList.contains(cls)).map((b) => b.dataset.date);
		expect(markedWith("is-note-day")).toEqual(["2026-09-23"]);
		expect(markedWith("is-today")).toEqual(["2026-09-24"]);
	});

	it("AC-CAL-14.2: activating a day asks the host to open that day's note", () => {
		const daily = leaf("2026-09-24.md");
		const { labels, opened } = manager([daily]);
		labels.sync();
		toggleOf(daily)?.click();

		dayButton(daily, "2026-09-26")?.click();

		expect(opened).toEqual(["2026-09-26"]);
		// The click is the day's, not the label's: the strip stays open.
		expect(stripOf(daily)).not.toBeNull();
	});

	it("an open strip survives a sync and follows the pane to its next note", () => {
		const pane = leaf("2026-09-24.md");
		const { labels } = manager([pane]);
		labels.sync();
		toggleOf(pane)?.click();

		labels.sync();
		expect(dayButtons(pane)).toHaveLength(7);

		pane.file = { path: "2026-W38.md" };
		labels.sync();
		expect(dayButtons(pane)[0]?.dataset.date).toBe("2026-09-13");
		expect(pane.contentEl.querySelectorAll(".calendaric-day-strip")).toHaveLength(1);
	});

	it("AC-CAL-14.2: switching daily notes off takes the strip away and leaves the label inert", () => {
		const weekly = leaf("2026-W38.md");
		const { labels, state } = manager([weekly]);
		labels.sync();
		toggleOf(weekly)?.click();
		expect(stripOf(weekly)).not.toBeNull();

		state.dayEnabled = false;
		labels.sync();
		expect(stripOf(weekly)).toBeNull();
		expect(toggleOf(weekly)?.hasAttribute("tabindex")).toBe(false);
		toggleOf(weekly)?.click();
		press(toggleOf(weekly) as HTMLElement, "Enter");
		expect(stripOf(weekly)).toBeNull();

		state.dayEnabled = true;
		labels.sync();
		toggleOf(weekly)?.click();
		expect(dayButtons(weekly)).toHaveLength(7);
	});

	it("a sync that changes nothing keeps the day buttons, so a focused day keeps focus", () => {
		const daily = leaf("2026-09-24.md");
		document.body.appendChild(daily.contentEl);
		const { labels, state } = manager([daily]);
		labels.sync();
		toggleOf(daily)?.click();
		const focused = dayButton(daily, "2026-09-22");
		focused?.focus();

		labels.sync();
		expect(dayButton(daily, "2026-09-22")).toBe(focused);
		expect(document.activeElement).toBe(focused);

		// Today moving on is a change: the mark follows it.
		state.now = "2026-09-25T00:01:00";
		labels.sync();
		expect(dayButtons(daily).filter((b) => b.classList.contains("is-today")).map((b) => b.dataset.date)).toEqual(["2026-09-25"]);
		daily.contentEl.remove();
	});

	it("closing the pane or destroying the labels takes the strip with them", () => {
		const daily = leaf("2026-09-24.md");
		const leaves = [daily];
		const { labels } = manager(leaves);
		labels.sync();
		toggleOf(daily)?.click();

		leaves.splice(0, 1);
		labels.sync();
		expect(stripOf(daily)).toBeNull();

		leaves.push(daily);
		labels.sync();
		expect(stripOf(daily)).toBeNull();
	});
});

describe("PeriodLabels", () => {
	it("AC-CAL-13.1: an open periodic note shows a label naming its period", () => {
		const daily = leaf("2026-09-24.md");
		const weekly = leaf("2026-W38.md");
		manager([daily, weekly]).labels.sync();

		expect(labelOf(daily)?.textContent).toBe("Today");
		expect(labelOf(weekly)?.textContent).toBe("Last week");
	});

	it("AC-CAL-13.2: a file that is not a periodic note gets no label and its content is unchanged", () => {
		const other = leaf("Projects/Plan.md");
		const empty = leaf(null);
		const before = other.contentEl.innerHTML;
		manager([other, empty]).labels.sync();

		expect(labelOf(other)).toBeNull();
		expect(labelOf(empty)).toBeNull();
		expect(other.contentEl.innerHTML).toBe(before);
	});

	it("AC-CAL-13.2: the label is view chrome beside the note's text, never inside it", () => {
		const daily = leaf("2026-09-24.md");
		manager([daily]).labels.sync();

		expect(daily.contentEl.querySelector(".markdown-source-view")?.textContent).toBe("# The note's own text");
		expect(labelOf(daily)?.parentElement).toBe(daily.contentEl);
	});

	it("AC-CAL-13.3: a periodic note opened after the setting is disabled shows no label", () => {
		const leaves: LabelLeaf[] = [];
		const { labels } = manager(leaves, { enabled: false, now: NOW, dayEnabled: true });
		labels.sync();

		const daily = leaf("2026-09-24.md");
		leaves.push(daily);
		labels.sync();

		expect(labelOf(daily)).toBeNull();
	});

	it("AC-CAL-13.4: a prefix-matched note's label carries the inexact-match marker; an exact one does not", () => {
		const inexact = leaf("2026-09-23 standup.md");
		const exact = leaf("2026-09-24.md");
		manager([inexact, exact]).labels.sync();

		expect(labelOf(inexact)?.querySelector(".calendaric-period-label-inexact")).not.toBeNull();
		expect(labelOf(exact)?.querySelector(".calendaric-period-label-inexact")).toBeNull();
	});

	it("AC-CAL-13.5: toggling the setting adds or removes the label in an already-open note", () => {
		const daily = leaf("2026-09-24.md");
		const { labels, state } = manager([daily]);
		labels.sync();
		expect(labelOf(daily)).not.toBeNull();

		state.enabled = false;
		labels.sync();
		expect(labelOf(daily)).toBeNull();

		state.enabled = true;
		labels.sync();
		expect(labelOf(daily)?.textContent).toBe("Today");
	});

	it("AC-CAL-13.6: closing one pane leaves the others' labels intact and leaves nothing behind", () => {
		const daily = leaf("2026-09-24.md");
		const weekly = leaf("2026-W38.md");
		const leaves = [daily, weekly];
		const { labels } = manager(leaves);
		labels.sync();
		const weeklyLabel = labelOf(weekly);

		leaves.splice(0, 1);
		labels.sync();

		expect(labelOf(daily)).toBeNull();
		expect(labelOf(weekly)).toBe(weeklyLabel);
		expect(weeklyLabel?.textContent).toBe("Last week");
	});

	it("AC-CAL-13.1: a note left open past midnight is renamed on the next sync", () => {
		const daily = leaf("2026-09-24.md");
		const { labels, state } = manager([daily]);
		labels.sync();

		state.now = "2026-09-25T00:01:00";
		labels.sync();

		expect(labelOf(daily)?.textContent).toBe("Yesterday");
	});

	it("follows the file when a pane switches to another note", () => {
		const pane = leaf("2026-09-24.md");
		const { labels } = manager([pane]);
		labels.sync();

		pane.file = { path: "2026-W38.md" };
		labels.sync();

		expect(pane.contentEl.querySelectorAll(".calendaric-period-label")).toHaveLength(1);
		expect(labelOf(pane)?.textContent).toBe("Last week");
	});

	it("removes every label it drew on destroy", () => {
		const daily = leaf("2026-09-24.md");
		const weekly = leaf("2026-W38.md");
		const { labels } = manager([daily, weekly]);
		labels.sync();

		labels.destroy();

		expect(labelOf(daily)).toBeNull();
		expect(labelOf(weekly)).toBeNull();
	});
});

describe("the plugin's period labels", () => {
	afterEach(() => {
		restoreLocale();
		vi.restoreAllMocks();
	});

	async function plugin() {
		const contentEl = document.createElement("div");
		const file = { path: `${window.moment().format("YYYY-MM-DD")}.md` };
		const view = Object.assign(new MarkdownView({} as never), { file, contentEl });
		const handlers: Record<string, () => void> = {};
		const on = (name: string, handler: () => void) => {
			handlers[name] = handler;
			return {};
		};
		const app = {
			workspace: { getLeavesOfType: (type: string) => (type === "markdown" ? [{ view }] : []), on },
			vault: { on },
		};

		const instance = new CalendaricPlugin({} as never, {} as never);
		Object.assign(instance, {
			app,
			loadData: () => Promise.resolve(null),
			registerEvent: () => {},
			registerInterval: (id: number) => id,
		});
		await instance.loadSettings();
		instance.settings.day = { ...instance.settings.day, enabled: true, format: "YYYY-MM-DD", folder: "" };

		const tick = vi.spyOn(window, "setInterval");
		(instance as unknown as { startPeriodLabels(): void }).startPeriodLabels();
		return { instance, file, handlers, tick, label: () => contentEl.querySelector(".calendaric-period-label") };
	}

	it("AC-CAL-13.6: a pane opening or switching file redraws the labels", async () => {
		const { file, handlers, label } = await plugin();

		handlers["layout-change"]?.();
		expect(label()).not.toBeNull();

		file.path = "Projects/Plan.md";
		handlers["file-open"]?.();
		expect(label()).toBeNull();
	});

	it("AC-CAL-13.5: a settings change adds or removes the label in an open pane", async () => {
		const { instance, handlers, label } = await plugin();
		handlers["layout-change"]?.();

		instance.settings.showPeriodLabel = false;
		instance.onSettingsChange();
		expect(label()).toBeNull();

		instance.settings.showPeriodLabel = true;
		instance.onSettingsChange();
		expect(label()).not.toBeNull();
	});

	/**
	 * The real plugin over a fake vault: a real index, and the plugin's own
	 * open-or-create path, so what a day in the strip does is what Obsidian runs.
	 */
	async function pluginOverVault(open: string, ...seeded: [path: string, content: string][]) {
		return pluginOverVaultFrom({}, open, ...seeded);
	}

	async function pluginOverVaultFrom(
		{ weekStart = "monday", dayEnabled = true }: { weekStart?: "monday" | "sunday"; dayEnabled?: boolean },
		open: string,
		...seeded: [path: string, content: string][]
	) {
		const vault = new FakeVaultPort();
		for (const [path, content] of seeded) vault.seedFile(path, content);
		const workspace = new FakeWorkspacePort();
		const ports: PeriodNotePorts = { vault, vaultConfig: new FakeVaultConfigPort(""), workspace };

		const contentEl = document.createElement("div");
		const view = Object.assign(new MarkdownView({} as never), { file: { path: open }, contentEl });
		const on = () => ({});
		const instance = new CalendaricPlugin({} as never, {} as never);
		Object.assign(instance, {
			app: { workspace: { getLeavesOfType: (type: string) => (type === "markdown" ? [{ view }] : []), on }, vault: { on } },
			loadData: () => Promise.resolve(null),
			registerEvent: () => {},
			registerInterval: (id: number) => id,
			notePorts: () => ports,
		});
		await instance.loadSettings();
		instance.settings.weekStart = weekStart;
		instance.settings.day = {
			...instance.settings.day,
			enabled: dayEnabled,
			format: "YYYY-MM-DD",
			folder: "Daily",
			templatePath: "Templates/Day.md",
			allowPrefixMatch: true,
		};
		instance.settings.week = { ...instance.settings.week, enabled: true, format: "GGGG-[W]WW", folder: "Weekly" };
		const internals = instance as unknown as { index: PeriodicNoteIndex | null; indexConfigs(): PeriodicConfigs; startPeriodLabels(): void };
		internals.index = new PeriodicNoteIndex(vault, new FakeVaultConfigPort(""), internals.indexConfigs());
		internals.startPeriodLabels();
		instance.onSettingsChange();

		const pane: LabelLeaf = { file: { path: open }, contentEl };
		toggleOf(pane)?.click();
		const paths = () => vault.listNotes().map((file) => file.path).sort();
		return { vault, workspace, pane, paths };
	}

	const TEMPLATE: [string, string] = ["Templates/Day.md", "# {{title}}"];

	it("AC-CAL-14.2: with daily notes switched off a weekly note offers no strip, so nothing is written beside a day's note", async () => {
		// Off, the index no longer knows day notes, so a day click could only write one.
		const { workspace, pane, paths } = await pluginOverVaultFrom(
			{ dayEnabled: false },
			"Weekly/2026-W16.md",
			["Weekly/2026-W16.md", ""],
			["Daily/2026-04-16 standup.md", "kept"],
		);
		const before = paths();

		expect(labelOf(pane)).not.toBeNull();
		expect(stripOf(pane)).toBeNull();
		expect(toggleOf(pane)?.getAttribute("role")).toBeNull();
		expect(workspace.opened).toEqual([]);
		expect(paths()).toEqual(before);
	});

	it("AC-CAL-14.1: the strip starts on the start-of-week day the settings name", async () => {
		const monday = await pluginOverVaultFrom({ weekStart: "monday" }, "Daily/2026-04-15.md", ["Daily/2026-04-15.md", ""]);
		const sunday = await pluginOverVaultFrom({ weekStart: "sunday" }, "Daily/2026-04-15.md", ["Daily/2026-04-15.md", ""]);

		expect(dayButtons(monday.pane)[0]?.dataset.date).toBe("2026-04-13");
		expect(dayButtons(sunday.pane)[0]?.dataset.date).toBe("2026-04-12");
	});

	it("AC-CAL-14.2: a neighbouring day that has a note opens that note in the pane, and no file is created", async () => {
		// A prefix-matched name is a note the writer would not have named, so only the index finds it.
		const { workspace, pane, paths } = await pluginOverVault(
			"Daily/2026-04-15.md",
			["Daily/2026-04-15.md", ""],
			["Daily/2026-04-16 standup.md", "kept"],
			TEMPLATE,
		);
		const before = paths();

		dayButton(pane, "2026-04-16")?.click();

		await vi.waitFor(() => expect(workspace.opened).toHaveLength(1));
		expect(workspace.opened[0]).toEqual({ file: { path: "Daily/2026-04-16 standup.md" }, mode: "reuse" });
		expect(paths()).toEqual(before);
		expect(workspace.notices).toEqual([]);
	});

	it("AC-CAL-14.3: a day with no note gets one written from the configured template, then opened in the pane", async () => {
		const { vault, workspace, pane, paths } = await pluginOverVault(
			"Daily/2026-04-15.md",
			["Daily/2026-04-15.md", ""],
			TEMPLATE,
		);

		dayButton(pane, "2026-04-17")?.click();

		await vi.waitFor(() => expect(workspace.opened).toHaveLength(1));
		expect(workspace.opened[0]).toEqual({ file: { path: "Daily/2026-04-17.md" }, mode: "reuse" });
		expect(paths()).toEqual(["Daily/2026-04-15.md", "Daily/2026-04-17.md", "Templates/Day.md"]);
		expect(vault.contentAt("Daily/2026-04-17.md")).toBe("# 2026-04-17");
	});

	it("AC-CAL-13.1: a clock tick redraws the labels, so a note open past midnight is renamed", async () => {
		const { tick, label } = await plugin();
		const [callback, delay] = tick.mock.calls[0] ?? [];

		expect(delay).toBe(60_000);
		(callback as () => void)();
		expect(label()).not.toBeNull();
	});
});

describe("the showPeriodLabel setting", () => {
	it("AC-CAL-13.3: defaults to on for a vault saved before it existed, and a disabled one survives a reload", () => {
		const stored = defaultStoredConfig() as unknown as Record<string, unknown>;
		delete stored.showPeriodLabel;
		const loaded = toSettings(stored as never);
		expect(loaded.showPeriodLabel).toBe(true);

		const saved = JSON.parse(
			JSON.stringify(applySettings(stored as never, { ...loaded, showPeriodLabel: false })),
		) as StoredConfig;
		expect(toSettings(saved).showPeriodLabel).toBe(false);
	});
});
