// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { App } from "obsidian";
import { CalendarWidget } from "./calendar";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { DEFAULT_SETTINGS } from "../settings/model";

/** `window.moment()` with no arguments answers `clock`; with arguments it parses as usual. */
let clock = "";
const realMoment = window.moment;

beforeEach(() => {
	window.moment = Object.assign(
		(...args: Parameters<typeof realMoment>) =>
			args.length === 0 ? realMoment(clock) : realMoment(...args),
		realMoment,
	);
});

afterEach(() => {
	window.moment = realMoment;
});

function eventOnlyApp(): App {
	return {
		workspace: {
			on: (): object => ({}),
			offref: (): undefined => undefined,
			trigger: (): undefined => undefined,
		},
	} as unknown as App;
}

function openAt(now: string) {
	clock = now;
	const host = document.createElement("div");
	const vault = new FakeVaultPort();
	const workspace = new FakeWorkspacePort();
	new CalendarWidget(host, eventOnlyApp(), DEFAULT_SETTINGS, {
		vault,
		vaultConfig: new FakeVaultConfigPort(),
		workspace,
	});
	return { host, vault, workspace };
}

function todayControl(host: HTMLElement): HTMLElement {
	const el = host.querySelector<HTMLElement>(".calendaric-today-btn");
	if (!el) throw new Error("no today control rendered");
	return el;
}

function header(host: HTMLElement): string {
	return host.querySelector(".calendaric-month-header")?.textContent ?? "";
}

function press(host: HTMLElement, label: "Previous month" | "Next month"): void {
	host.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click();
}

describe("AC-CAL-02.4: the return-to-today control is inactive on the current month", () => {
	it("AC-CAL-02.4: renders inactive on the current month and active on any other", () => {
		const { host } = openAt("2026-09-14T10:00:00");
		const control = todayControl(host);

		expect(control.classList.contains("is-disabled")).toBe(true);
		expect(control.getAttribute("aria-disabled")).toBe("true");

		press(host, "Next month");

		expect(control.classList.contains("is-disabled")).toBe(false);
		expect(control.getAttribute("aria-disabled")).toBe("false");
	});

	it("AC-CAL-02.4: activating it while inactive changes nothing", async () => {
		const { host, vault, workspace } = openAt("2026-09-14T10:00:00");
		const createFile = vi.spyOn(vault, "createFile");
		// renderGrid() empties the tbody and builds fresh rows, so a re-render
		// replaces this node.
		const firstRow = host.querySelector("tbody tr");
		expect(firstRow).not.toBeNull();

		todayControl(host).click();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(header(host)).toBe("Sep2026");
		expect(host.querySelector("tbody tr")).toBe(firstRow);
		expect(host.contains(firstRow)).toBe(true);
		expect(workspace.opened).toEqual([]);
		expect(createFile).not.toHaveBeenCalled();
		expect(vault.createdFolders).toEqual([]);
	});
});
