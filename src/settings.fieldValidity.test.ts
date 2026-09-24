// @vitest-environment happy-dom
//
// US-SET-04: the format, folder and template fields say whether what was typed
// is usable, on the settings screen itself. Every assertion reads the rendered
// tab after the same DOM events a user produces: `input` while typing, `blur`
// when leaving the field.
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import type { App, TextComponent } from "obsidian";
import { CalendaricSettingsTab } from "./settings";
import type { SettingsTabPorts } from "./settings";
import { FakeVaultPort } from "./adapters/fakeVaultPort";
import {
	applySettings,
	defaultStoredConfig,
	loadStoredConfig,
	toSettings,
	type CalendaricSettings,
} from "./settings/model";
import { makeSettingsTabPorts } from "./__mocks__/settingsTabPorts";
import type CalendaricPlugin from "./main";

// The shared `Setting` mock leaves `addText` unbuilt, and the folder and
// template fields are drawn through it. This file gives it the part of
// Obsidian's text component the tab uses: an input whose `input` event is
// `onChange`.
vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	class TextSetting extends actual.Setting {
		addText(cb: (text: TextComponent) => unknown): this {
			const inputEl = this.controlEl.createEl("input", { attr: { type: "text" } });
			const text = {
				inputEl,
				setPlaceholder: (value: string) => {
					inputEl.placeholder = value;
					return text;
				},
				setValue: (value: string) => {
					inputEl.value = value;
					return text;
				},
				onChange: (handler: (value: string) => unknown) => {
					inputEl.addEventListener("input", () => handler(inputEl.value));
					return text;
				},
			};
			cb(text as unknown as TextComponent);
			return this;
		}
	}
	return { ...actual, Setting: TextSetting };
});

function makeApp(): App {
	return {
		vault: { adapter: {} },
		internalPlugins: {
			getPluginById: () => ({ enabled: false, disable: () => undefined, instance: { options: {} } }),
		},
	} as unknown as App;
}

function renderTab(settings: CalendaricSettings, ports: Partial<SettingsTabPorts> = {}) {
	const app = makeApp();
	const saveSettings = vi.fn(() => Promise.resolve());
	const plugin = { app, settings, saveSettings, onSettingsChange: () => undefined } as unknown as CalendaricPlugin;
	const tab = new CalendaricSettingsTab(app, plugin, makeSettingsTabPorts(app, ports));
	tab.display();
	return { tab, saveSettings };
}

function field(tab: CalendaricSettingsTab, name: string) {
	const row = Array.from(tab.containerEl.querySelectorAll<HTMLElement>(".setting-item")).find(
		(el) => el.querySelector(".setting-item-name")?.textContent === name,
	);
	if (!row) throw new Error(`no settings row named ${name}`);
	return {
		input: row.querySelector("input") as HTMLInputElement,
		problem: () => row.querySelector(".calendaric-setting-problem")?.textContent ?? "",
	};
}

function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event("input"));
	input.dispatchEvent(new Event("change"));
	input.dispatchEvent(new Event("blur"));
}

/** Save and load the way the plugin does, so a reopen sees only what survived storage. */
function reload(settings: CalendaricSettings): CalendaricSettings {
	const stored: unknown = JSON.parse(JSON.stringify(applySettings(defaultStoredConfig(), settings)));
	return toSettings(loadStoredConfig(stored));
}

describe("format field validity", () => {
	it("AC-SET-04.1: an invalid format shows an inline message and marks the field invalid", () => {
		const { tab } = renderTab(toSettings(defaultStoredConfig()));
		const format = field(tab, "Format");
		expect(format.input.getAttribute("aria-invalid")).toBeNull();

		type(format.input, "");

		expect(format.problem()).not.toBe("");
		expect(format.input.getAttribute("aria-invalid")).toBe("true");

		type(format.input, "YYYY-MM-DD");

		expect(format.problem()).toBe("");
		expect(format.input.getAttribute("aria-invalid")).toBeNull();
	});
});

describe("folder field validity", () => {
	it("AC-SET-04.2: a folder that does not exist warns on blur and is still saved", () => {
		const { tab, saveSettings } = renderTab(toSettings(defaultStoredConfig()));
		const folder = field(tab, "Note Folder");

		folder.input.value = "Journal/Daily";
		folder.input.dispatchEvent(new Event("input"));
		expect(folder.problem()).toBe("");

		folder.input.dispatchEvent(new Event("blur"));

		expect(folder.problem()).toContain("Journal/Daily");
		expect(folder.problem()).toContain("does not exist");
		expect(folder.input.getAttribute("aria-invalid")).toBe("true");
		expect(saveSettings).toHaveBeenCalled();
	});

	it("AC-SET-04.2: a folder that exists shows no warning", () => {
		const vault = new FakeVaultPort();
		vault.seedFolder("Journal");
		const { tab } = renderTab(toSettings(defaultStoredConfig()), { vault });
		const folder = field(tab, "Note Folder");

		type(folder.input, "Journal");

		expect(folder.problem()).toBe("");
		expect(folder.input.getAttribute("aria-invalid")).toBeNull();
	});
});

describe("template field validity", () => {
	it("AC-SET-04.3: a missing template errors on blur and is still saved", () => {
		const settings = toSettings(defaultStoredConfig());
		const { tab, saveSettings } = renderTab(settings);
		const template = field(tab, "Daily Note Template");

		type(template.input, "Templates/missing.md");

		expect(template.problem()).toContain("Templates/missing.md");
		expect(template.problem()).toContain("not found");
		expect(template.input.getAttribute("aria-invalid")).toBe("true");
		expect(settings.day.templatePath).toBe("Templates/missing.md");
		expect(saveSettings).toHaveBeenCalled();
	});
});

describe("reopening the settings screen", () => {
	it("AC-SET-04.4: each field shows what was typed and the same warning after a reopen", () => {
		const settings = toSettings(defaultStoredConfig());
		const typed = { Format: "DD", "Note Folder": "Journal/Daily/", "Daily Note Template": " Templates/missing" };

		const { tab } = renderTab(settings);
		const shown: Record<string, string> = {};
		for (const [name, value] of Object.entries(typed)) {
			type(field(tab, name).input, value);
			shown[name] = field(tab, name).problem();
			expect(shown[name]).not.toBe("");
		}

		const { tab: reopened } = renderTab(reload(settings));

		for (const [name, value] of Object.entries(typed)) {
			expect(field(reopened, name).input.value).toBe(value);
			expect(field(reopened, name).problem()).toBe(shown[name]);
			expect(field(reopened, name).input.getAttribute("aria-invalid")).toBe("true");
		}
	});
});

describe("format guide link", () => {
	it("AC-SET-04.5: activating the guide link opens the guide without throwing", () => {
		const openPluginFile = vi.fn();
		const { tab } = renderTab(toSettings(defaultStoredConfig()), { desktop: { openPluginFile } });
		const link = Array.from(tab.containerEl.querySelectorAll("a")).find(
			(a) => a.textContent === "Format & template guide",
		);

		expect(() => link?.dispatchEvent(new MouseEvent("click", { cancelable: true }))).not.toThrow();
		expect(openPluginFile).toHaveBeenCalledWith("docs/guide.md");
	});
});

describe("manifest", () => {
	it("AC-SET-04.6: manifest.json declares the plugin desktop-only", () => {
		const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as { isDesktopOnly: unknown };
		expect(manifest.isDesktopOnly).toBe(true);
	});
});
