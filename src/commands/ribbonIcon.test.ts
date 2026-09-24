// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import type { Command } from "obsidian";
import type { LeafMode } from "../adapters/workspacePort";
import type { Granularity, PeriodicConfig, ReleaseGranularity } from "../types";
import type { MenuEntry, RibbonHost } from "./ribbonIcon";
import { RIBBON_ICON, RibbonIcon } from "./ribbonIcon";
import { GranularityCommands } from "./granularityCommands";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { openOrCreatePeriodNote } from "../notes/periodNoteOpen";

/**
 * Stands in for the plugin's ribbon: records every icon it was asked for.
 * Wires the callback the way Obsidian's `onClickEvent` does, to `click` and
 * `auxclick` both, so a right-click reaches it too.
 */
class FakeRibbon implements RibbonHost {
	icons: { icon: string; title: string; el: HTMLElement }[] = [];
	tooltips: string[] = [];

	addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => void): HTMLElement {
		const el = document.createElement("div");
		el.addEventListener("click", callback);
		el.addEventListener("auxclick", callback);
		this.icons.push({ icon, title, el });
		return el;
	}

	setTooltip(_el: HTMLElement, tooltip: string): void {
		this.tooltips.push(tooltip);
	}
}

function setUp(isMacOS = false) {
	const ribbon = new FakeRibbon();
	const opened: { granularity: ReleaseGranularity; mode: LeafMode }[] = [];
	const menus: MenuEntry[][] = [];
	const icon = new RibbonIcon(
		ribbon,
		isMacOS,
		(granularity, mode) => opened.push({ granularity, mode }),
		(entries) => menus.push(entries),
	);
	return { ribbon, opened, menus, icon };
}

/** A configuration with exactly these granularities switched on. */
function active(...on: Granularity[]): Partial<Record<Granularity, { enabled: boolean }>> {
	const configs: Partial<Record<Granularity, { enabled: boolean }>> = {};
	for (const granularity of ["day", "week", "month", "quarter", "year"] as const) {
		configs[granularity] = { enabled: on.includes(granularity) };
	}
	return configs;
}

const click = (el: HTMLElement, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent("click", init));
const rightClick = (el: HTMLElement) => {
	el.dispatchEvent(new MouseEvent("auxclick", { button: 2 }));
	el.dispatchEvent(new MouseEvent("contextmenu", { button: 2, cancelable: true }));
};

describe("AC-CMD-08.1: one ribbon icon for the first active granularity", () => {
	it("AC-CMD-08.1: exactly one icon appears, for the first active granularity in day, week, month, year order", () => {
		const { ribbon, icon } = setUp();
		icon.sync(active("year", "month", "week"));

		expect(ribbon.icons).toHaveLength(1);
		expect(ribbon.icons[0]).toMatchObject({ icon: RIBBON_ICON, title: "Open current weekly note" });
	});

	it("AC-CMD-08.1: a settings change moves the icon to the new first granularity without adding a second one", () => {
		const { ribbon, opened, icon } = setUp();
		icon.sync(active("week", "month"));
		icon.sync(active("day", "week", "month"));

		expect(ribbon.icons).toHaveLength(1);
		expect(ribbon.tooltips).toEqual(["Open current daily note"]);
		click(ribbon.icons[0]!.el);
		expect(opened).toEqual([{ granularity: "day", mode: "reuse" }]);
	});
});

describe("AC-CMD-08.2 / AC-CMD-08.3: clicking the icon", () => {
	it("AC-CMD-08.2: a plain click opens the current note of the icon's granularity in the active pane", () => {
		const { ribbon, opened, icon } = setUp();
		icon.sync(active("month", "year"));
		click(ribbon.icons[0]!.el);

		expect(opened).toEqual([{ granularity: "month", mode: "reuse" }]);
	});

	it("AC-CMD-08.3: cmd-click on macOS opens it in a new split", () => {
		const { ribbon, opened, icon } = setUp(true);
		icon.sync(active("day"));
		click(ribbon.icons[0]!.el, { metaKey: true });

		expect(opened).toEqual([{ granularity: "day", mode: "split" }]);
	});

	it("AC-CMD-08.3: ctrl-click elsewhere opens it in a new split", () => {
		const { ribbon, opened, icon } = setUp(false);
		icon.sync(active("day"));
		click(ribbon.icons[0]!.el, { ctrlKey: true });

		expect(opened).toEqual([{ granularity: "day", mode: "split" }]);
	});
});

describe("AC-CMD-08.2 / AC-CMD-08.3: the open itself creates the note first, in the pane asked for", () => {
	const config: PeriodicConfig = {
		enabled: true,
		format: "YYYY-MM-DD",
		folder: "Daily",
		templatePath: "",
		allowPrefixMatch: false,
		openAtStartup: false,
	};
	const ports = () => ({ vault: new FakeVaultPort(), vaultConfig: new FakeVaultConfigPort(), workspace: new FakeWorkspacePort() });

	it("AC-CMD-08.2: with no mode given, a missing note is created and opened in the active pane", async () => {
		const p = ports();
		await openOrCreatePeriodNote("day", window.moment("2026-09-25"), config, null, p);

		expect(p.vault.getFile("Daily/2026-09-25.md")).not.toBeNull();
		expect(p.workspace.opened.map((o) => [o.file.path, o.mode])).toEqual([["Daily/2026-09-25.md", "reuse"]]);
	});

	it("AC-CMD-08.3: with split, a missing note is created and opened in a new split", async () => {
		const p = ports();
		await openOrCreatePeriodNote("day", window.moment("2026-09-25"), config, null, p, "split");

		expect(p.vault.getFile("Daily/2026-09-25.md")).not.toBeNull();
		expect(p.workspace.opened.map((o) => [o.file.path, o.mode])).toEqual([["Daily/2026-09-25.md", "split"]]);
	});

	it("AC-CMD-08.3: with split, a note that already exists opens in a new split", async () => {
		const p = ports();
		await openOrCreatePeriodNote("day", window.moment("2026-09-25"), config, null, p);
		const existing = p.vault.getFile("Daily/2026-09-25.md");
		await openOrCreatePeriodNote("day", window.moment("2026-09-25"), config, existing, p, "split");

		expect(p.workspace.opened.map((o) => o.mode)).toEqual(["reuse", "split"]);
	});
});

describe("AC-CMD-08.4: the right-click menu", () => {
	it("AC-CMD-08.4: lists one entry per active granularity, each opening that granularity's current note", () => {
		const { ribbon, opened, menus, icon } = setUp();
		icon.sync(active("day", "month", "year"));
		rightClick(ribbon.icons[0]!.el);

		expect(menus).toHaveLength(1);
		expect(menus[0]!.map((entry) => entry.title)).toEqual([
			"Open current daily note",
			"Open current monthly note",
			"Open current yearly note",
		]);
		expect(opened).toEqual([]);
		for (const entry of menus[0]!) entry.open();
		expect(opened).toEqual([
			{ granularity: "day", mode: "reuse" },
			{ granularity: "month", mode: "reuse" },
			{ granularity: "year", mode: "reuse" },
		]);
	});

	it("AC-CMD-08.4: with a single active granularity a right-click shows no menu and opens nothing", () => {
		const { ribbon, opened, menus, icon } = setUp();
		icon.sync(active("week"));
		rightClick(ribbon.icons[0]!.el);

		expect(menus).toEqual([]);
		expect(opened).toEqual([]);
	});
});

describe("AC-CMD-08.5: no granularity active", () => {
	it("AC-CMD-08.5: no ribbon icon is shown", () => {
		const { ribbon, icon } = setUp();
		icon.sync(active());

		expect(ribbon.icons).toEqual([]);
	});

	it("AC-CMD-08.5: the icon appears once a granularity is switched on", () => {
		const { ribbon, icon } = setUp();
		icon.sync(active());
		icon.sync(active("month"));

		expect(ribbon.icons.map((i) => i.title)).toEqual(["Open current monthly note"]);
	});
});

describe("AC-CMD-08.6: a reserved granularity stays out of the ribbon", () => {
	it("AC-CMD-08.6: an active quarter gets no ribbon icon", () => {
		const { ribbon, icon } = setUp();
		icon.sync(active("quarter"));

		expect(ribbon.icons).toEqual([]);
	});

	it("AC-CMD-08.6: an active quarter neither takes the icon nor gets a menu entry", () => {
		const { ribbon, menus, icon } = setUp();
		icon.sync(active("quarter", "month", "year"));
		rightClick(ribbon.icons[0]!.el);

		expect(ribbon.icons.map((i) => i.title)).toEqual(["Open current monthly note"]);
		expect(menus[0]!.map((entry) => entry.title)).toEqual(["Open current monthly note", "Open current yearly note"]);
	});

	it("AC-CMD-08.6: an active quarter gets no command", () => {
		const added: Command[] = [];
		const commands = new GranularityCommands(
			{ addCommand: (command) => (added.push(command), command), removeCommand: () => {} },
			() => {},
		);
		commands.sync(active("quarter"));

		expect(added).toEqual([]);
	});
});
