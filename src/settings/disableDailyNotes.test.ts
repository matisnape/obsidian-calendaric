// @vitest-environment happy-dom
//
// US-MIG-02: the core Daily Notes plugin is turned off only after the user
// confirms. Each case renders the real import card over the real companion
// adapter, so the chain under test is card -> confirm modal -> adapter -> the
// host plugin's own `disable`. Only the host object is fake.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { App } from "obsidian";
import { renderDailyNotesImportCard } from "./dailyNotesImportCard";
import { DisableDailyNotesModal } from "./disableDailyNotesModal";
import { DEFAULT_SETTINGS, type CalendaricSettings } from "./model";
import { ObsidianCompanionPluginAdapter } from "../adapters/obsidianCompanionPluginAdapter";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { PredecessorGuard, guardCreation } from "../notes/predecessorGuard";
import { openOrCreatePeriodNote } from "../notes/periodNoteOpen";
import { computeNotePath } from "../notes/noteUtils";
import type CalendaricPlugin from "../main";

// The shared Notice stub records nothing; this one keeps each message.
const notices = vi.hoisted(() => [] as string[]);
vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	class RecordingNotice extends actual.Notice {
		constructor(message: string) {
			super(message);
			notices.push(message);
		}
	}
	return { ...actual, Notice: RecordingNotice };
});

/** The core Daily Notes plugin as Obsidian's internal registry hands it out. */
function makeHost() {
	const plugin: Record<string, unknown> = {
		enabled: true,
		instance: { options: { format: "DD-MM-YYYY", folder: "Journal", template: "" } },
		enable: vi.fn(),
	};
	const disable = vi.fn(function (this: Record<string, unknown>) {
		this.enabled = false;
	});
	plugin.disable = disable;
	const host = {
		plugin: plugin as Record<string, unknown> | null,
		disable,
		vault: { adapter: {}, delete: vi.fn(), trash: vi.fn() },
	};
	const app = {
		vault: host.vault,
		internalPlugins: { getPluginById: () => host.plugin },
	} as unknown as App;
	return { ...host, app, set(value: Record<string, unknown> | null) { host.plugin = value; } };
}

type Host = ReturnType<typeof makeHost>;

/** Settings with an empty day config, so the import has nothing to ask about. */
function freshSettings(migrated = false): CalendaricSettings {
	const settings = structuredClone(DEFAULT_SETTINGS);
	Object.assign(settings.day, { format: "", folder: "", templatePath: "" });
	settings.hasMigratedDailyNoteSettings = migrated;
	return settings;
}

function renderCard(host: Host, settings: CalendaricSettings) {
	const containerEl = document.createElement("div");
	const plugin = {
		app: host.app,
		settings,
		saveSettings: vi.fn(() => Promise.resolve()),
		onSettingsChange: vi.fn(),
	} as unknown as CalendaricPlugin;
	const companion = new ObsidianCompanionPluginAdapter(host.app);
	const actions = {
		save: vi.fn(() => Promise.resolve()),
		refresh: vi.fn(() => draw()),
	};
	const draw = () => {
		containerEl.empty();
		renderDailyNotesImportCard(containerEl, plugin, companion, actions);
	};
	draw();
	return { containerEl, actions, companion };
}

function button(el: HTMLElement, label: string): HTMLButtonElement {
	const found = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === label);
	if (!found) throw new Error(`No "${label}" button in: ${el.textContent ?? ""}`);
	return found;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Modal.open() in the shared stub does nothing; record each modal and draw it.
let modals: DisableDailyNotesModal[] = [];
beforeEach(() => {
	modals = [];
	notices.length = 0;
	vi.spyOn(DisableDailyNotesModal.prototype, "open").mockImplementation(function (this: DisableDailyNotesModal) {
		modals.push(this);
		this.onOpen();
	});
});
afterEach(() => {
	vi.restoreAllMocks();
});

/** The two places the card offers to disable the core plugin. */
const paths = [
	{ name: "the import offer", migrated: false, label: "Disable Daily Notes plugin" },
	{ name: "the notice shown after import", migrated: true, label: "Disable Daily Notes" },
];

describe.each(paths)("disabling from $name", ({ migrated, label }) => {
	it("AC-MIG-02.1: asks first, says the plugin will be turned off and warns about hotkeys", async () => {
		const host = makeHost();
		const { containerEl, actions } = renderCard(host, freshSettings(migrated));

		button(containerEl, label).click();
		await flush();

		expect(modals).toHaveLength(1);
		const text = modals[0]!.contentEl.textContent ?? "";
		expect(text).toMatch(/turn off/i);
		expect(text).toMatch(/hotkeys/i);
		expect(host.disable).not.toHaveBeenCalled();
		expect(actions.save).not.toHaveBeenCalled();

		button(modals[0]!.contentEl, "Disable plugin").click();
		await flush();

		expect(host.disable).toHaveBeenCalledTimes(1);
	});

	it("AC-MIG-02.3: Cancel leaves the plugin enabled and untouched", async () => {
		const host = makeHost();
		const { containerEl } = renderCard(host, freshSettings(migrated));

		button(containerEl, label).click();
		button(modals[0]!.contentEl, "Cancel").click();
		await flush();

		expect(host.disable).not.toHaveBeenCalled();
		expect(host.plugin?.enabled).toBe(true);
	});

	it("AC-MIG-02.3: closing the dialog leaves the plugin enabled and untouched", async () => {
		const host = makeHost();
		const { containerEl } = renderCard(host, freshSettings(migrated));

		button(containerEl, label).click();
		// Escape and the close button both end in close(), which runs onClose().
		modals[0]!.close();
		modals[0]!.onClose();
		await flush();

		expect(host.disable).not.toHaveBeenCalled();
		expect(host.plugin?.enabled).toBe(true);
	});

	it("AC-MIG-02.3: Dismiss leaves the plugin enabled and opens no dialog", async () => {
		const host = makeHost();
		const { containerEl } = renderCard(host, freshSettings(migrated));

		button(containerEl, "Dismiss").click();
		await flush();

		expect(modals).toHaveLength(0);
		expect(host.disable).not.toHaveBeenCalled();
		expect(host.plugin?.enabled).toBe(true);
	});

	it("AC-MIG-02.4: confirming calls only the host's disable(true) and deletes no setting or note", async () => {
		const host = makeHost();
		const settings = freshSettings(migrated);
		const { containerEl } = renderCard(host, settings);
		const before = structuredClone(settings);
		const optionsBefore = structuredClone(host.plugin?.instance);

		button(containerEl, label).click();
		button(modals[0]!.contentEl, "Disable plugin").click();
		await flush();

		// disable(true) is Obsidian's own "turn off and remember it", the same
		// switch its plugin list flips, so the list can turn it back on.
		expect(host.disable.mock.calls).toEqual([[true]]);
		expect(host.plugin?.enable).not.toHaveBeenCalled();
		expect(host.plugin?.instance).toEqual(optionsBefore);
		expect(host.vault.delete).not.toHaveBeenCalled();
		expect(host.vault.trash).not.toHaveBeenCalled();
		// The offer path records the import as handled; nothing else may change.
		expect(settings).toEqual({ ...before, hasMigratedDailyNoteSettings: true });
	});

	it("AC-MIG-02.5: a plugin gone by the time the user confirms shows a notice and throws nothing", async () => {
		const host = makeHost();
		const { containerEl, actions } = renderCard(host, freshSettings(migrated));

		button(containerEl, label).click();
		host.set(null);
		button(modals[0]!.contentEl, "Disable plugin").click();
		await flush();

		expect(notices).toEqual([expect.stringMatching(/^Could not disable the core Daily Notes plugin/)]);
		expect(actions.save).not.toHaveBeenCalled();
	});
});

describe("AC-MIG-02.5: the disable action when the host plugin cannot be turned off", () => {
	it("AC-MIG-02.5: a disable that throws shows the notice and throws nothing", async () => {
		const host = makeHost();
		const { containerEl, actions } = renderCard(host, freshSettings());
		host.plugin!.disable = vi.fn(() => {
			throw new Error("host refused");
		});

		button(containerEl, "Disable Daily Notes plugin").click();
		button(modals[0]!.contentEl, "Disable plugin").click();
		await flush();

		expect(notices).toEqual([expect.stringMatching(/host refused/)]);
		expect(actions.save).not.toHaveBeenCalled();
	});

	it("AC-MIG-02.5: a plugin with no disable method shows the notice and throws nothing", async () => {
		const host = makeHost();
		const { containerEl, actions } = renderCard(host, freshSettings(true));
		delete host.plugin!.disable;

		button(containerEl, "Disable Daily Notes").click();
		button(modals[0]!.contentEl, "Disable plugin").click();
		await flush();

		expect(notices).toEqual([expect.stringMatching(/no 'disable' method/)]);
		expect(actions.save).not.toHaveBeenCalled();
	});

	it("AC-MIG-02.5: a plugin already turned off elsewhere throws nothing and the card goes away", async () => {
		const host = makeHost();
		const { containerEl, actions } = renderCard(host, freshSettings(true));

		button(containerEl, "Disable Daily Notes").click();
		host.plugin!.enabled = false;
		button(modals[0]!.contentEl, "Disable plugin").click();
		await flush();

		expect(notices).toEqual([]);
		expect(actions.refresh).toHaveBeenCalled();
		expect(containerEl.querySelectorAll("button")).toHaveLength(0);
	});
});

describe("AC-MIG-02.2: day notes after the core plugin is turned off", () => {
	const absent = { ok: false as const, reason: "absent" as const, problem: "" };

	it("AC-MIG-02.2: Calendaric creates and opens the day note from the imported configuration", async () => {
		const host = makeHost();
		const settings = freshSettings();
		const { containerEl, companion } = renderCard(host, settings);

		button(containerEl, "Import settings").click();
		await flush();
		const imported = structuredClone(settings.day);
		expect(imported).toMatchObject({ enabled: true, format: "DD-MM-YYYY", folder: "Journal" });

		// The real refusal: while core Daily Notes is on, it owns the day.
		const ports = { vault: new FakeVaultPort(), vaultConfig: new FakeVaultConfigPort(), workspace: new FakeWorkspacePort() };
		const guard = new PredecessorGuard(
			{
				companion,
				calendar: { readCalendarWeeklyNotes: () => absent, disableCalendarWeeklyNotes: () => Promise.resolve({ ok: true }) },
				periodicNotes: { readActiveGranularities: () => absent, disableGranularity: () => Promise.resolve({ ok: true }) },
			},
			(granularity) => granularity === "day" && settings.day.enabled,
			() => undefined,
		);
		guardCreation(ports.vault.backingVault, guard);
		try {
			const date = window.moment("2026-04-13");
			await openOrCreatePeriodNote("day", date, settings.day, null, ports);
			expect(ports.workspace.opened).toEqual([]);

			button(containerEl, "Disable Daily Notes").click();
			button(modals[0]!.contentEl, "Disable plugin").click();
			await flush();
			expect(host.disable).toHaveBeenCalledWith(true);
			expect(settings.day).toEqual(imported);

			await openOrCreatePeriodNote("day", date, settings.day, null, ports);
			const path = computeNotePath(date, imported, ports.vaultConfig, "day");
			expect(path).toBe("Journal/13-04-2026.md");
			expect(ports.workspace.opened.map((o) => o.file.path)).toEqual([path]);
		} finally {
			guardCreation(ports.vault.backingVault, null);
		}
	});
});
