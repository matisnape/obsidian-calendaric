// @vitest-environment happy-dom
//
// US-FMT-01 through the grid: a weekday token outside a weekly format is part
// of the note's name, so the day cell and the month header look for the name
// the commands write, not a resolved one.
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { CalendarWidget } from "./calendar";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { DEFAULT_SETTINGS } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";

const SETTINGS: CalendaricSettings = {
	...DEFAULT_SETTINGS,
	weekStart: "monday",
	day: { ...DEFAULT_SETTINGS.day, enabled: true, folder: "", format: "YYYY-MM-DD {{monday:DD.MM}}" },
	month: { ...DEFAULT_SETTINGS.month, enabled: true, folder: "", format: "YYYY-MM {{monday:DD}}" },
};

const firstOfMonth = () => window.moment().startOf("month");

function render(vault: FakeVaultPort, triggered: unknown[][] = []): HTMLElement {
	const app = {
		workspace: {
			on: (): object => ({}),
			offref: (): undefined => undefined,
			trigger: (...args: unknown[]): void => void triggered.push(args),
		},
	} as unknown as App;
	const host = document.createElement("div");
	new CalendarWidget(host, app, SETTINGS, { vault, vaultConfig: new FakeVaultConfigPort(), workspace: new FakeWorkspacePort() });
	return host;
}

describe("AC-FMT-01.4 in the calendar grid", () => {
	it("the day cell shows the dot of the note under the literal name", () => {
		const vault = new FakeVaultPort();
		vault.seedFile(`${firstOfMonth().date(12).format("YYYY-MM-DD")} {{monday:DD.MM}}.md`, "");
		const host = render(vault);
		const cell = Array.from(host.querySelectorAll<HTMLElement>(".calendaric-day:not(.is-adjacent-month)")).find(
			(el) => el.firstChild?.textContent === "12",
		);
		expect(cell?.querySelectorAll(".calendaric-dot--exists")).toHaveLength(1);
	});

	it("the month header's context menu finds the note under the literal name", () => {
		const vault = new FakeVaultPort();
		vault.seedFile(`${firstOfMonth().format("YYYY-MM")} {{monday:DD}}.md`, "");
		const triggered: unknown[][] = [];
		const host = render(vault, triggered);
		const header = host.querySelector(".calendaric-month-header")!;
		header.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		expect(triggered.filter((args) => args[0] === "file-menu")).toHaveLength(1);
	});
});
