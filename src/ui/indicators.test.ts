// @vitest-environment happy-dom
//
// US-ARCH-05: a calendar indicator is one module behind one interface. These
// tests register indicators the way a new one is added, through the indicator
// list, and never touch the renderer.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { App } from "obsidian";
import { CalendarWidget } from "./calendar";
import { computeNotePath } from "../notes/noteUtils";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { DEFAULT_SETTINGS } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";
import type { CalendarIndicator, IndicatorCell } from "../indicatorContract";

/**
 * A new indicator, one module's worth of code satisfying the documented
 * interface, plus every set of cells it was handed. Hoisted, because the mock
 * below runs while the imports above are still being evaluated.
 */
const fake = vi.hoisted(() => {
	const seen: IndicatorCell[][] = [];
	const indicator: CalendarIndicator = {
		apiVersion: 1,
		id: "fake-mark",
		draw(cells) {
			seen.push([...cells]);
			for (const cell of cells) {
				if (!cell.noteExists) continue;
				const mark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
				mark.setAttribute("class", "fake-mark");
				cell.container.appendChild(mark);
			}
		},
	};
	return { indicator, seen, staleDraw: vi.fn() };
});

// The registry path: the indicator list the renderer imports, with entries added.
vi.mock("./indicators", async (original) => {
	const real = await original<typeof import("./indicators")>();
	const stale = { apiVersion: 2, id: "stale-indicator", draw: fake.staleDraw } as unknown as CalendarIndicator;
	return { CALENDAR_INDICATORS: [...real.CALENDAR_INDICATORS, fake.indicator, stale] };
});

const SETTINGS: CalendaricSettings = {
	...DEFAULT_SETTINGS,
	showWeekNumbers: true,
	weekStart: "monday",
	day: { ...DEFAULT_SETTINGS.day, enabled: true, format: "YYYY-MM-DD" },
	week: { ...DEFAULT_SETTINGS.week, enabled: true, format: "gggg-[W]ww" },
};

function eventOnlyApp(): App {
	return {
		workspace: {
			on: (): object => ({}),
			offref: (): undefined => undefined,
			trigger: (): undefined => undefined,
		},
	} as unknown as App;
}

const dayPath = (dayOfMonth: number): string =>
	computeNotePath(
		window.moment().startOf("month").add(dayOfMonth - 1, "day"),
		SETTINGS.day,
		new FakeVaultConfigPort(),
		"day",
	);

async function render(notes: Record<string, string>): Promise<HTMLElement> {
	const vault = new FakeVaultPort();
	for (const [path, content] of Object.entries(notes)) vault.seedFile(path, content);
	const host = document.createElement("div");
	new CalendarWidget(host, eventOnlyApp(), SETTINGS, {
		vault,
		vaultConfig: new FakeVaultConfigPort(),
		workspace: new FakeWorkspacePort(),
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	return host;
}

function dayCell(host: HTMLElement, dayOfMonth: number): HTMLElement {
	const cell = Array.from(host.querySelectorAll<HTMLElement>(".calendaric-day:not(.is-adjacent-month)")).find(
		(el) => el.firstChild?.textContent === String(dayOfMonth),
	);
	if (!cell) throw new Error(`no cell for day ${dayOfMonth}`);
	return cell;
}

const marks = (cell: HTMLElement): string[] =>
	Array.from(cell.querySelectorAll(".calendaric-dot-container > *")).map((el) => el.getAttribute("class") ?? "");

let logged: MockInstance<typeof console.error>;

beforeEach(() => {
	// Every render here carries the stale indicator, so every render reports it.
	logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
	fake.seen.length = 0;
	fake.staleDraw.mockClear();
	vi.restoreAllMocks();
});

describe("AC-ARCH-05.2: a new indicator is drawn without a change to the renderer", () => {
	it("AC-ARCH-05.2: a registered indicator renders next to the existing dots, in day and week cells", async () => {
		const host = await render({ [dayPath(3)]: "three words here" });

		expect(marks(dayCell(host, 3))).toEqual([
			"calendaric-dot calendaric-dot--exists",
			"fake-mark",
			"calendaric-dot calendaric-dot--words",
		]);
		expect(marks(dayCell(host, 4))).toEqual([]);

		const cells = fake.seen[fake.seen.length - 1] ?? [];
		expect(new Set(cells.map((cell) => cell.granularity))).toEqual(new Set(["day", "week"]));
		expect(cells.find((cell) => cell.path === dayPath(3))?.noteExists).toBe(true);
	});
});

describe("AC-ARCH-05.3: an indicator written against another interface version is refused, not redrawn", () => {
	it("AC-ARCH-05.3: the renderer skips an indicator whose apiVersion does not match and logs an error naming it", async () => {
		const host = await render({ [dayPath(3)]: "" });

		expect(fake.staleDraw).not.toHaveBeenCalled();
		expect(logged).toHaveBeenCalledTimes(1);
		expect(String(logged.mock.calls[0]?.[0])).toContain('"stale-indicator"');
		// The indicators that match still draw.
		expect(marks(dayCell(host, 3))).toEqual(["calendaric-dot calendaric-dot--exists", "fake-mark"]);
	});
});
