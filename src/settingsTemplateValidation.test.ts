// @vitest-environment happy-dom
//
// US-TPL-04 on the surface the story names: the settings screen.
//
// The validator has its own unit tests in notes/validateTemplatePath.test.ts.
// What those cannot show is that the message reaches the screen, and the story
// is explicit that the user finds out "at configuration time rather than the
// first time a note is created". So every assertion here reads text out of the
// rendered tab rather than a return value.
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { CalendaricSettingsTab } from "./settings";
import { FakeVaultPort } from "./adapters/fakeVaultPort";
import { DEFAULT_SETTINGS } from "./settings/model";
import { ObsidianCompanionPluginAdapter } from "./adapters/obsidianCompanionPluginAdapter";
import type CalendaricPlugin from "./main";

function makeApp(): App {
	return {
		vault: { adapter: {} },
		internalPlugins: {
			getPluginById: () => ({ enabled: false, disable: () => undefined, instance: { options: {} } }),
		},
	} as unknown as App;
}

/**
 * Render the whole tab with `templatePath` configured for the day granularity,
 * and hand back the text of every problem line on screen.
 *
 * The day group is collapsed by default, which hides nothing from a query: the
 * content is rendered into the DOM either way, and `display: none` is the only
 * difference.
 */
function problemsFor(templatePath: string, vault: FakeVaultPort): string[] {
	const app = makeApp();
	const settings = structuredClone(DEFAULT_SETTINGS);
	settings.day.templatePath = templatePath;
	const plugin = {
		app,
		settings,
		saveSettings: () => Promise.resolve(),
		onSettingsChange: () => undefined,
	} as unknown as CalendaricPlugin;

	const tab = new CalendaricSettingsTab(app, plugin, {
		companion: new ObsidianCompanionPluginAdapter(app),
		desktop: { openPluginFile: () => undefined },
		vault,
	});
	tab.display();

	return Array.from(tab.containerEl.querySelectorAll(".calendaric-setting-problem"))
		.map((el) => el.textContent ?? "")
		.filter((text) => text !== "");
}

describe("the template field on the settings screen", () => {
	it("AC-TPL-04.1: shows no problem for a template path that resolves to a note", () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/daily.md", "# {{title}}");

		expect(problemsFor("Templates/daily.md", vault)).toEqual([]);
	});

	it("AC-TPL-04.2: shows the template as not found, by name, where it was configured", () => {
		const vault = new FakeVaultPort();

		const problems = problemsFor("Templates/missing.md", vault);

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("Templates/missing.md");
		expect(problems[0]).toContain("not found");
	});

	it("AC-TPL-04.3: shows a folder as a folder rather than as a missing file", () => {
		const vault = new FakeVaultPort();
		vault.seedFolder("Templates/daily");

		const problems = problemsFor("Templates/daily", vault);

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("Templates/daily");
		expect(problems[0]).toContain("folder");
		expect(problems[0]).not.toContain("not found");
	});

	it("AC-TPL-04.4: shows no problem when no template is configured", () => {
		expect(problemsFor("", new FakeVaultPort())).toEqual([]);
	});

	it("AC-TPL-04.1: shows no problem for a template file that is empty", () => {
		const vault = new FakeVaultPort();
		vault.seedFile("Templates/empty.md", "");

		expect(problemsFor("Templates/empty.md", vault)).toEqual([]);
	});
});
