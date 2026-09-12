// @vitest-environment happy-dom
//
// AC-ARCH-07.3, end to end and with nothing mocked but the host itself.
//
// The chain under test is the one a user actually walks: main.ts registers this
// tab, the tab renders the Daily Notes import card, the card asks
// decideDailyNotesCard, and that asks the adapter to read the core plugin's
// options. Here those options are a state container that publishes no usable
// value -- what a renamed or restructured companion looks like from outside.
//
// The criterion's forbidden outcome is an import button that still looks live
// and would write three empty strings over the user's own settings. So the
// assertions are about what is on the screen, not about the value returned.
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { CalendaricSettingsTab } from "./settings";
import { DEFAULT_SETTINGS } from "./settings/model";
import type CalendaricPlugin from "./main";

/** The core Daily Notes plugin, with its options behind a store. */
function makeApp(options: unknown): App {
	return {
		vault: { adapter: {} },
		internalPlugins: {
			getPluginById: () => ({ enabled: true, disable: () => undefined, instance: { options } }),
		},
	} as unknown as App;
}

function render(options: unknown): HTMLElement {
	const app = makeApp(options);
	const plugin = {
		app,
		settings: structuredClone(DEFAULT_SETTINGS),
		saveSettings: () => Promise.resolve(),
		onSettingsChange: () => undefined,
	} as unknown as CalendaricPlugin;
	const tab = new CalendaricSettingsTab(app, plugin);
	tab.display();
	return tab.containerEl;
}

const buttonLabels = (el: HTMLElement): string[] =>
	Array.from(el.querySelectorAll("button")).map((b) => b.textContent ?? "");

describe("the Daily Notes import when the companion's state cannot be read", () => {
	/** A store that has a subscribe method and publishes nothing through it. */
	const emptyStore = { subscribe: () => () => undefined };

	it("AC-ARCH-07.3: tells the user the settings could not be read", () => {
		const containerEl = render(emptyStore);

		const notice = containerEl.querySelector(".calendaric-callout--warning");
		expect(notice?.textContent).toMatch(/could not be read/i);
	});

	it("AC-ARCH-07.3: names the documented fallback, which is entering them by hand", () => {
		const containerEl = render(emptyStore);

		expect(containerEl.querySelector(".calendaric-callout--warning")?.textContent).toMatch(/by hand/i);
	});

	it("AC-ARCH-07.3: offers no import button that would store empty values", () => {
		const containerEl = render(emptyStore);

		expect(buttonLabels(containerEl)).not.toContain("Import settings");
	});

	// The same tab, same chain, with options this code can read: the offer is
	// there. Without this the three assertions above would also pass on a tab
	// that had simply stopped rendering the card at all.
	it("AC-ARCH-07.3: still offers the import when the store publishes readable values", () => {
		const containerEl = render({
			subscribe: (run: (v: unknown) => void) => {
				run({ format: "YYYY-MM-DD", folder: "Daily", template: "t/d" });
				return () => undefined;
			},
		});

		expect(buttonLabels(containerEl)).toContain("Import settings");
		expect(containerEl.querySelector(".calendaric-callout--warning")).toBeNull();
	});
});
