// @vitest-environment happy-dom
//
// The widget with no Obsidian behind it at all: every vault question it asks
// goes to a fake port handed in through the constructor (AC-ARCH-11.4). The
// sibling file calendarRender.test.ts covers the same widget over the real
// adapters, so the two together check both sides of the boundary.
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { CalendarWidget } from "./calendar";
import { computeNotePath } from "../notes/noteUtils";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import type { CalendarDeps } from "../adapters/calendarDeps";
import { DEFAULT_SETTINGS } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";

/** Daily notes on, in the vault root, so a seeded note earns a dot. */
const DAILY: CalendaricSettings = {
	...DEFAULT_SETTINGS,
	day: { ...DEFAULT_SETTINGS.day, enabled: true, format: "YYYY-MM-DD" },
};

/**
 * The workspace events the pane subscribes to, and nothing else.
 *
 * `file-open` and `file-menu` are UI events on the Obsidian `ItemView` the pane
 * lives in, not vault access, so they stay on the `App` object. No module
 * import is patched anywhere in this file: the fakes arrive as an argument.
 */
function eventOnlyApp(): App {
	return {
		workspace: {
			on: (): object => ({}),
			offref: (): undefined => undefined,
			trigger: (): undefined => undefined,
		},
	} as unknown as App;
}

function dayPath(dayOfMonth: number): string {
	const date = window.moment().startOf("month").add(dayOfMonth - 1, "day");
	return computeNotePath(date, DAILY.day, new FakeVaultConfigPort(), "day");
}

function dotsIn(host: HTMLElement): number {
	return host.querySelectorAll(".calendaric-dot").length;
}

describe("CalendarWidget, built from fakes", () => {
	it("AC-ARCH-11.4: renders and reacts to a vault change with fake ports only", () => {
		const vault = new FakeVaultPort();
		vault.seedFile(dayPath(1), "");
		const deps: CalendarDeps = {
			vault,
			vaultConfig: new FakeVaultConfigPort(),
			workspace: new FakeWorkspacePort(),
		};
		const host = document.createElement("div");

		const widget = new CalendarWidget(host, eventOnlyApp(), DAILY, deps);

		// Rendered: the grid is there, and the one seeded note has its dot.
		expect(host.querySelectorAll("tbody tr")).toHaveLength(6);
		expect(dotsIn(host)).toBe(1);

		// Reacted: a note created in the vault lights its cell without the pane
		// being asked to refresh.
		vault.seedFile(dayPath(2), "");
		vault.emitChange({ kind: "create", file: { path: dayPath(2) } });

		expect(dotsIn(host)).toBe(2);

		// And the subscription is given back on close, so a closed pane stops
		// re-rendering on every vault write.
		widget.destroy();
		vault.seedFile(dayPath(3), "");
		vault.emitChange({ kind: "create", file: { path: dayPath(3) } });
		expect(dotsIn(host)).toBe(0);
	});
});
