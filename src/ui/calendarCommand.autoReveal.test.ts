// @vitest-environment happy-dom
//
// US-CMD-02: the calendar view appears by itself once the workspace layout is
// ready. These tests run the real onload() against a stub workspace, so they
// prove the reveal is wired to onLayoutReady, not only that the coordinator
// could do it if someone called it.
import { describe, it, expect, vi } from "vitest";
import type { Command } from "obsidian";
import CalendaricPlugin from "../main";
import { VIEW_TYPE_CALENDAR } from "./viewType";
import { CALENDAR_COMMAND_ID } from "./calendarCommand";

// onload() reads the app language and draws the ribbon tooltip; the shared
// mock carries neither.
vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<typeof import("obsidian")>()),
	getLanguage: () => "en",
	setTooltip: () => undefined,
}));

interface StubLeaf {
	viewType: string | null;
	revealed: number;
	detach(): void;
}

async function load(options: { layoutReady: boolean; restoredLeaf?: boolean }) {
	const calendarLeaves: StubLeaf[] = [];
	const rightSplit = { collapsed: false };
	let pendingLayoutReady: (() => void) | null = null;
	const commands: Command[] = [];
	let rightLeavesRequested = 0;

	function stubLeaf(): StubLeaf & Record<string, unknown> {
		const leaf = {
			viewType: null as string | null,
			revealed: 0,
			view: { containerEl: { isShown: () => true } },
			getRoot: () => rightSplit,
			setViewState: async (state: { type: string }) => {
				leaf.viewType = state.type;
				if (state.type === VIEW_TYPE_CALENDAR) calendarLeaves.push(leaf);
			},
			detach: () => {
				calendarLeaves.splice(calendarLeaves.indexOf(leaf), 1);
			},
		};
		return leaf;
	}

	if (options.restoredLeaf) {
		const restored = stubLeaf();
		restored.viewType = VIEW_TYPE_CALENDAR;
		calendarLeaves.push(restored);
	}

	const on = () => ({});
	const app = {
		workspace: {
			// Obsidian's contract: run now when the layout is already ready,
			// otherwise hold the callback until it is.
			onLayoutReady: (callback: () => void) => {
				if (options.layoutReady) callback();
				else pendingLayoutReady = callback;
			},
			getLeavesOfType: (type: string) => (type === VIEW_TYPE_CALENDAR ? [...calendarLeaves] : []),
			getRightLeaf: () => {
				rightLeavesRequested += 1;
				return stubLeaf();
			},
			revealLeaf: async (leaf: StubLeaf) => {
				leaf.revealed += 1;
			},
			setActiveLeaf: () => undefined,
			rightSplit,
			on,
		},
		vault: {
			on,
			getMarkdownFiles: () => [],
		},
		metadataCache: { on, offref: () => undefined, getFileCache: () => null, getFirstLinkpathDest: () => null },
	};

	const instance = new CalendaricPlugin({} as never, {} as never);
	Object.assign(instance, {
		app,
		loadData: () => Promise.resolve(null),
		registerView: () => undefined,
		addSettingTab: () => undefined,
		registerHoverLinkSource: () => undefined,
		addRibbonIcon: () => document.createElement("div"),
		addCommand: (command: Command) => {
			commands.push(command);
			return command;
		},
		registerEvent: () => undefined,
		registerInterval: (id: number) => id,
	});
	await instance.onload();
	await settle();

	return {
		calendarLeaves,
		rightLeavesRequested: () => rightLeavesRequested,
		fireLayoutReady: async () => {
			pendingLayoutReady?.();
			await settle();
		},
		openCalendarCommand: () => commands.find((command) => command.id === CALENDAR_COMMAND_ID),
	};
}

/** ensure() and the command drop their promises; drain the queue before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("US-CMD-02: the calendar view opens itself on layout ready", () => {
	it("AC-CMD-02.1: opens the calendar view during load when the layout is already ready", async () => {
		const { calendarLeaves } = await load({ layoutReady: true });

		expect(calendarLeaves).toHaveLength(1);
		expect(calendarLeaves[0]?.viewType).toBe(VIEW_TYPE_CALENDAR);
	});

	it("AC-CMD-02.2: waits for the layout-ready signal, then opens the calendar view", async () => {
		const { calendarLeaves, fireLayoutReady } = await load({ layoutReady: false });

		expect(calendarLeaves).toEqual([]);
		await fireLayoutReady();

		expect(calendarLeaves).toHaveLength(1);
	});

	it("AC-CMD-02.3: creates no second leaf when Obsidian restored one", async () => {
		const { calendarLeaves, rightLeavesRequested } = await load({ layoutReady: true, restoredLeaf: true });

		expect(calendarLeaves).toHaveLength(1);
		expect(rightLeavesRequested()).toBe(0);
	});

	it("AC-CMD-02.4: opens nothing without the layout-ready signal, and the command still opens it", async () => {
		const { calendarLeaves, openCalendarCommand } = await load({ layoutReady: false });
		await settle();
		expect(calendarLeaves).toEqual([]);

		const command = openCalendarCommand();
		expect(command?.name).toBe("Open calendar");
		expect(command?.checkCallback?.(true)).toBe(true);
		command?.checkCallback?.(false);
		await settle();

		expect(calendarLeaves).toHaveLength(1);
		expect(calendarLeaves[0]?.revealed).toBe(1);
	});
});
