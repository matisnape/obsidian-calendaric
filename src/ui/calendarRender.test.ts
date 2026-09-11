// @vitest-environment happy-dom
//
// The only DOM-environment test file in the suite. Every other test runs in
// node, which is faster; opt in here per-file rather than flipping the default
// so the 557 node tests keep their speed.
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { CalendarWidget } from "./calendar";
import { DEFAULT_SETTINGS } from "../settings/model";
import type { CalendaricSettings } from "../settings/model";

// Structural App fixture — CalendarWidget subscribes to workspace/vault events
// and asks the vault whether a note exists. An empty vault answers "no" to
// every path, so no dots are drawn and the grid is the bare rectangle.
function makeApp(): App {
	return {
		workspace: { on: () => ({}), offref: () => undefined, trigger: () => undefined },
		vault: {
			on: () => ({}),
			offref: () => undefined,
			getAbstractFileByPath: () => null,
			config: {},
		},
	} as unknown as App;
}

function render(settings: CalendaricSettings): HTMLElement {
	const host = document.createElement("div");
	new CalendarWidget(host, makeApp(), settings);
	return host;
}

function cellsPerRow(host: HTMLElement): number[] {
	return Array.from(host.querySelectorAll("tbody tr")).map(
		(row) => row.querySelectorAll("td").length,
	);
}

describe("CalendarWidget: the week-number column", () => {
	it("AC-CAL-01.5: renders no week-number header or cells when showWeekNumbers is off", () => {
		const shown = render({ ...DEFAULT_SETTINGS, showWeekNumbers: true });
		expect(shown.querySelectorAll(".calendaric-weeknum-header")).toHaveLength(1);
		expect(shown.querySelectorAll(".calendaric-weeknum-cell")).toHaveLength(6);
		expect(cellsPerRow(shown)).toEqual([8, 8, 8, 8, 8, 8]);

		const hidden = render({ ...DEFAULT_SETTINGS, showWeekNumbers: false });
		expect(hidden.querySelectorAll(".calendaric-weeknum-header")).toHaveLength(0);
		expect(hidden.querySelectorAll(".calendaric-weeknum-cell")).toHaveLength(0);
		// The column is gone, not merely emptied: seven day cells, no eighth.
		expect(cellsPerRow(hidden)).toEqual([7, 7, 7, 7, 7, 7]);
	});
});
