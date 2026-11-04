// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { App } from "obsidian";
import { CalendarWidget } from "./calendar";
import { DETAIL_CLOSE_DELAY_MS, DETAIL_OPEN_DELAY_MS } from "./indicatorDetail";
import { computeNotePath } from "../notes/noteUtils";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { DEFAULT_SETTINGS } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";

const settings: CalendaricSettings = {
	...DEFAULT_SETTINGS,
	confirmBeforeCreate: false,
	day: { ...DEFAULT_SETTINGS.day, enabled: true, format: "YYYY-MM-DD" },
};

function eventOnlyApp(): App {
	return {
		workspace: { on: (): object => ({}), offref: (): undefined => undefined, trigger: (): undefined => undefined },
	} as unknown as App;
}

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

// happy-dom does no layout: every element gets the same on-screen box, so the overlay stays open.
const BOX = { left: 10, top: 10, right: 50, bottom: 30, width: 40, height: 20, x: 10, y: 10 } as DOMRect;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(BOX);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

/** A calendar with a 300-word note on day 3 of the current month and no note on day 5. */
async function render() {
	const vault = new FakeVaultPort();
	const workspace = new FakeWorkspacePort();
	vault.seedFile(computeNotePath(window.moment().startOf("month").add(2, "day"), settings.day, new FakeVaultConfigPort(), "day"), words(300));
	const host = document.body.appendChild(document.createElement("div"));
	new CalendarWidget(host, eventOnlyApp(), settings, { vault, vaultConfig: new FakeVaultConfigPort(), workspace });
	await settle();
	const day = (n: number): HTMLElement => {
		const cell = Array.from(host.querySelectorAll<HTMLElement>(".calendaric-day:not(.is-adjacent-month)")).find(
			(el) => el.firstChild?.textContent === String(n),
		);
		if (!cell) throw new Error(`no cell for day ${n}`);
		return cell;
	};
	return { host, vault, workspace, day };
}

const detail = () => document.querySelector<HTMLElement>(".calendaric-indicator-detail");
const lines = () => Array.from(detail()?.querySelectorAll(".calendaric-indicator-detail-line") ?? []).map((el) => el.textContent);

const pointer = (el: Element, type: string, pointerType: string) =>
	el.dispatchEvent(new PointerEvent(type, { bubbles: type !== "pointerenter" && type !== "pointerleave", pointerType }));

async function hover(el: HTMLElement): Promise<void> {
	pointer(el, "pointerenter", "mouse");
	await vi.advanceTimersByTimeAsync(DETAIL_OPEN_DELAY_MS);
	await settle();
}

/**
 * A touch tap as Chromium orders it: pointerdown, focus, then click, with the
 * microtasks between those dispatches run, as a browser runs them. The click is
 * a plain MouseEvent, so only the press says it was a touch.
 */
async function tap(el: HTMLElement): Promise<void> {
	pointer(el, "pointerdown", "touch");
	el.focus();
	await settle();
	pointer(el, "pointerup", "touch");
	el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	await settle();
}

const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
	el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));

describe("US-CAL-08: indicator detail without needing to hover", () => {
	it("AC-CAL-08.1: resting the pointer on a cell with indicators shows each indicator's value near the cell", async () => {
		const { day } = await render();

		pointer(day(3), "pointerenter", "mouse");
		await vi.advanceTimersByTimeAsync(DETAIL_OPEN_DELAY_MS - 1);
		pointer(day(3), "pointerleave", "mouse");
		await vi.advanceTimersByTimeAsync(1000);
		expect(detail()).toBeNull();

		pointer(day(3), "pointerenter", "mouse");
		await vi.advanceTimersByTimeAsync(DETAIL_OPEN_DELAY_MS - 1);
		await settle();
		expect(detail()).toBeNull();
		await vi.advanceTimersByTimeAsync(1);
		await settle();

		expect(lines()).toEqual(["Note exists", "300 words"]);
		expect(detail()?.classList.contains("calendaric-overlay")).toBe(true);
		// Placed by placeOverlay: under the cell's stubbed box.
		expect([detail()?.style.left, detail()?.style.top]).toEqual(["10px", "30px"]);
	});

	it("AC-CAL-08.2: leaving the cell closes the detail view after the 250 ms dismissal delay", async () => {
		const { day } = await render();
		await hover(day(3));

		pointer(day(3), "pointerleave", "mouse");
		expect(DETAIL_CLOSE_DELAY_MS).toBe(250);
		await vi.advanceTimersByTimeAsync(249);
		expect(detail()).not.toBeNull();
		await vi.advanceTimersByTimeAsync(1);
		expect(detail()).toBeNull();
	});

	it("AC-CAL-08.2: moving from the cell onto the detail view keeps it open, and leaving it closes it", async () => {
		const { day } = await render();
		await hover(day(3));
		const view = detail()!;

		pointer(day(3), "pointerleave", "mouse");
		pointer(view, "pointerenter", "mouse");
		await vi.advanceTimersByTimeAsync(1000);
		expect(view.isConnected).toBe(true);

		pointer(view, "pointerleave", "mouse");
		await vi.advanceTimersByTimeAsync(250);
		expect(view.isConnected).toBe(false);
	});

	it("AC-CAL-08.2: the focus a mouse click gives the cell does not keep the view open once the pointer leaves", async () => {
		const { day } = await render();
		await hover(day(3));

		pointer(day(3), "pointerdown", "mouse");
		day(3).focus();
		day(3).click();
		await settle();
		pointer(day(3), "pointerleave", "mouse");
		await vi.advanceTimersByTimeAsync(250);

		expect(detail()).toBeNull();
	});

	it("AC-CAL-08.3: a touch tap shows the same detail instead of opening the note, and a second tap opens it", async () => {
		const { day, workspace } = await render();

		await tap(day(3));

		expect(lines()).toEqual(["Note exists", "300 words"]);
		expect(workspace.opened).toHaveLength(0);
		// The touch pointer leaving after the tap lifts is not a hover ending.
		pointer(day(3), "pointerleave", "touch");
		await vi.advanceTimersByTimeAsync(1000);
		expect(detail()).not.toBeNull();

		await tap(day(3));

		expect(workspace.opened).toHaveLength(1);
	});

	it("AC-CAL-08.3: the tapped detail view's Open note button opens the note; a mouse click still opens it at once", async () => {
		const { day, workspace } = await render();

		await tap(day(3));
		const button = Array.from(detail()?.querySelectorAll("button") ?? []).find((el) => el.textContent === "Open note");
		expect(button).toBeDefined();
		// Tapping the button moves focus off the cell; that blur must not close the view under the tap.
		button!.focus();
		expect(detail()).not.toBeNull();
		button!.click();
		await settle();
		expect(workspace.opened).toHaveLength(1);

		pointer(day(3), "pointerdown", "mouse");
		day(3).click();
		await settle();
		expect(workspace.opened).toHaveLength(2);
	});

	it("AC-CAL-08.4: a cell with no indicator data shows no detail view on hover, focus or tap", async () => {
		const { day, vault } = await render();
		const createFile = vi.spyOn(vault, "createFile");

		await hover(day(5));
		expect(detail()).toBeNull();

		day(5).focus();
		await settle();
		expect(detail()).toBeNull();
		day(5).blur();

		await tap(day(5));
		expect(detail()).toBeNull();
		// No detail to show, so the first tap does what a click does.
		expect(createFile).toHaveBeenCalledTimes(1);
	});

	it("AC-CAL-08.5: day and week cells take keyboard focus, and focus shows the detail as the cell's description", async () => {
		const { host, day } = await render();

		expect(day(3).getAttribute("tabindex")).toBe("0");
		expect(host.querySelector(".calendaric-weeknum")?.getAttribute("tabindex")).toBe("0");

		// A touch that starts a scroll is cancelled and gives no focus; the keyboard focus after it still counts.
		pointer(day(3), "pointerdown", "touch");
		pointer(day(3), "pointercancel", "touch");
		day(3).focus();
		await settle();

		expect(lines()).toEqual(["Note exists", "300 words"]);
		expect(detail()?.getAttribute("role")).toBe("tooltip");
		expect(day(3).getAttribute("aria-describedby")).toBe(detail()?.id);
		expect(detail()?.id).not.toBe("");

		pointer(day(3), "pointerenter", "mouse");
		pointer(day(3), "pointerleave", "mouse");
		await vi.advanceTimersByTimeAsync(1000);
		expect(day(3).getAttribute("aria-describedby")).toBe(detail()?.id);

		day(3).blur();
		await hover(day(3));
		pointer(day(3), "pointerleave", "mouse");
		await vi.advanceTimersByTimeAsync(250);
		expect(detail()).toBeNull();
	});

	it("AC-CAL-08.5: Escape and blur close the detail view, and Enter or Space open the note as a click does", async () => {
		const { day, workspace } = await render();
		// After a tap, Enter opens the note: the tap's touch press is over.
		await tap(day(3));
		key(day(3), "Escape");
		key(day(3), "Enter");
		await settle();
		expect(workspace.opened).toHaveLength(1);
		// After a blur, the next focus is keyboard focus again, even after a press dragged off without a click.
		day(3).blur();
		pointer(day(3), "pointerdown", "mouse");
		day(3).focus();
		day(3).blur();

		day(3).focus();
		await settle();
		expect(detail()).not.toBeNull();
		key(day(3), "Escape");
		expect(detail()).toBeNull();
		expect(day(3).hasAttribute("aria-describedby")).toBe(false);
		pointer(day(3), "pointerenter", "mouse");
		pointer(day(3), "pointerleave", "mouse");
		await vi.advanceTimersByTimeAsync(1000);
		expect(detail()).toBeNull();

		day(3).blur();
		day(3).focus();
		await settle();
		expect(detail()).not.toBeNull();
		day(3).blur();
		expect(detail()).toBeNull();

		day(3).focus();
		key(day(3), "Enter");
		await settle();
		expect(workspace.opened).toHaveLength(2);
		key(day(3), " ");
		await settle();
		expect(workspace.opened).toHaveLength(3);
		key(day(3), "Enter", { ctrlKey: true });
		await settle();
		expect(workspace.opened.map((open) => open.mode)).toEqual(["reuse", "reuse", "reuse", "split"]);
	});
});

describe("the month navigation controls work from the keyboard", () => {
	it("prev, next and Today are focusable buttons that Enter and Space activate", async () => {
		const { host } = await render();
		const header = () => host.querySelector(".calendaric-month-header")?.textContent;
		const prev = host.querySelector<HTMLElement>('[aria-label="Previous month"]')!;
		const next = host.querySelector<HTMLElement>('[aria-label="Next month"]')!;
		const today = host.querySelector<HTMLElement>(".calendaric-today-btn")!;
		for (const el of [prev, next, today]) {
			expect(el.getAttribute("role")).toBe("button");
			expect(el.getAttribute("tabindex")).toBe("0");
		}
		const current = header();

		key(next, "Enter");
		expect(header()).not.toBe(current);
		key(today, " ");
		expect(header()).toBe(current);
		key(prev, "Enter");
		expect(header()).not.toBe(current);
		expect(today.getAttribute("aria-disabled")).toBe("false");
	});
});
