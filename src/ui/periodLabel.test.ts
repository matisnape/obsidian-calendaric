// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { humanizePeriod, PeriodLabels } from "./periodLabel";
import type { LabelLeaf, LabelledFile } from "./periodLabel";
import CalendaricPlugin from "../main";
import { MarkdownView } from "obsidian";
import { restoreLocale } from "../fmt/locale";
import { applySettings, defaultStoredConfig, toSettings } from "../settings/model";
import type { StoredConfig } from "../settings/model";

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

function manager(leaves: LabelLeaf[], state = { enabled: true, now: NOW }) {
	const labels = new PeriodLabels({
		leaves: () => leaves,
		enabled: () => state.enabled,
		resolve: (path) => FILES[path] ?? null,
		now: () => window.moment(state.now),
		weekFormat: () => "gggg-[W]ww",
	});
	return { labels, state };
}

const labelOf = (l: LabelLeaf) => l.contentEl.querySelector(".calendaric-period-label");

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
		const { labels } = manager(leaves, { enabled: false, now: NOW });
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
