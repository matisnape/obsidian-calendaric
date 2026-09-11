import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { ObsidianCalendarLeafAdapter } from "./obsidianCalendarLeafAdapter";
import type { CalendarLeafHandle } from "./calendarLeafPort";
import { VIEW_TYPE_CALENDAR } from "../ui/viewType";

interface FakeSplit {
	collapsed: boolean;
}

interface FakeLeaf {
	/** Still in the workspace. detach() clears it, and find() then misses it. */
	attached: boolean;
	/** What setViewState recorded; a leaf is only a calendar leaf once set. */
	viewState: { type: string; active: boolean } | null;
	/** Whether an ancestor hides the element, which is what isShown() reports. */
	shown: boolean;
	root: FakeSplit | object | null;
	setViewStateFails: boolean;
}

interface FakeWorkspace {
	leaves: FakeLeaf[];
	/** What getRightLeaf hands out, or null when the workspace has none. */
	rightLeafFactory: (() => FakeLeaf) | null;
	leftSplit: FakeSplit;
	rightSplit: FakeSplit;
	revealed: FakeLeaf[];
	activated: { leaf: FakeLeaf; focus: boolean | undefined }[];
}

function makeLeaf(overrides: Partial<FakeLeaf> = {}): FakeLeaf {
	return {
		attached: true,
		viewState: { type: VIEW_TYPE_CALENDAR, active: true },
		shown: true,
		root: null,
		setViewStateFails: false,
		...overrides,
	};
}

/**
 * Structural App fixture that models the state the adapter moves through, so a
 * broken transition fails a test instead of passing quietly.
 *
 * It pins the parts no headless environment provides — isShown(), getRoot() and
 * the sidedock collapsed flag — and, unlike a pure recorder, it applies the
 * effects the real workspace applies: setViewState makes a leaf discoverable by
 * getLeavesOfType, revealLeaf expands the leaf's sidedock and shows the leaf,
 * and detach removes it from discovery.
 */
function makeApp(workspace: FakeWorkspace): App {
	function wrap(fake: FakeLeaf) {
		return {
			fake,
			view: { containerEl: { isShown: () => fake.shown } },
			getRoot: () => fake.root,
			detach: () => {
				fake.attached = false;
			},
			setViewState: async (state: { type: string; active: boolean }) => {
				if (fake.setViewStateFails) throw new Error("view failed to initialize");
				fake.viewState = state;
			},
		};
	}

	const api = {
		workspace: {
			leftSplit: workspace.leftSplit,
			rightSplit: workspace.rightSplit,

			getLeavesOfType: (type: string) =>
				workspace.leaves
					.filter((leaf) => leaf.attached && leaf.viewState?.type === type)
					.map(wrap),

			getRightLeaf: () => {
				if (!workspace.rightLeafFactory) return null;
				const leaf = workspace.rightLeafFactory();
				// The real getRightLeaf attaches the leaf before the caller has
				// set any view on it, which is the state a failed create leaks.
				workspace.leaves.push(leaf);
				return wrap(leaf);
			},

			revealLeaf: async (leaf: { fake: FakeLeaf }) => {
				workspace.revealed.push(leaf.fake);
				if (leaf.fake.root === workspace.leftSplit) workspace.leftSplit.collapsed = false;
				if (leaf.fake.root === workspace.rightSplit) workspace.rightSplit.collapsed = false;
				leaf.fake.shown = true;
			},

			setActiveLeaf: (
				leaf: { fake: FakeLeaf },
				pushHistoryOrParams?: boolean | { focus?: boolean },
				focus?: boolean,
			) => {
				// Accept both signatures so the fixture cannot hide which one
				// the adapter picked; the assertions check the focus that arrived.
				const requested =
					typeof pushHistoryOrParams === "object"
						? pushHistoryOrParams.focus
						: focus;
				workspace.activated.push({ leaf: leaf.fake, focus: requested });
			},
		},
	};

	return api as unknown as App;
}

function makeWorkspace(overrides: Partial<FakeWorkspace> = {}): FakeWorkspace {
	return {
		leaves: [],
		rightLeafFactory: null,
		leftSplit: { collapsed: false },
		rightSplit: { collapsed: false },
		revealed: [],
		activated: [],
		...overrides,
	};
}

/**
 * The handle for the fixture's first calendar leaf, built by find() rather than
 * by hand, so the test cannot drift from how the adapter wraps a leaf.
 */
function firstCalendarLeaf(app: App): CalendarLeafHandle {
	const found = new ObsidianCalendarLeafAdapter(app).find();
	if (!found) throw new Error("fixture has no calendar leaf");
	return found;
}

describe("ObsidianCalendarLeaf.isVisible", () => {
	it("is false when an ancestor hides the leaf, such as an inactive dock tab", () => {
		const leaf = makeLeaf({ shown: false });
		const app = makeApp(makeWorkspace({ leaves: [leaf] }));

		expect(firstCalendarLeaf(app).isVisible()).toBe(false);
	});

	it("is false when the leaf sits in a collapsed right sidebar", () => {
		const rightSplit = { collapsed: true };
		const leaf = makeLeaf({ root: rightSplit });
		const app = makeApp(makeWorkspace({ leaves: [leaf], rightSplit }));

		expect(firstCalendarLeaf(app).isVisible()).toBe(false);
	});

	it("is false when the leaf sits in a collapsed left sidebar", () => {
		const leftSplit = { collapsed: true };
		const leaf = makeLeaf({ root: leftSplit });
		const app = makeApp(makeWorkspace({ leaves: [leaf], leftSplit }));

		expect(firstCalendarLeaf(app).isVisible()).toBe(false);
	});

	it("is true when the leaf sits in an expanded sidebar", () => {
		const rightSplit = { collapsed: false };
		const leaf = makeLeaf({ root: rightSplit });
		const app = makeApp(makeWorkspace({ leaves: [leaf], rightSplit }));

		expect(firstCalendarLeaf(app).isVisible()).toBe(true);
	});

	it("is true for a shown leaf in the editor area, which has no sidebar", () => {
		const leaf = makeLeaf({ root: { notASidedock: true } });
		const app = makeApp(makeWorkspace({ leaves: [leaf] }));

		expect(firstCalendarLeaf(app).isVisible()).toBe(true);
	});
});

describe("ObsidianCalendarLeaf", () => {
	it("reveals the leaf through the workspace", async () => {
		const leaf = makeLeaf();
		const workspace = makeWorkspace({ leaves: [leaf] });
		const app = makeApp(workspace);

		await firstCalendarLeaf(app).reveal();

		expect(workspace.revealed).toEqual([leaf]);
	});

	it("asks for keyboard focus explicitly, because revealLeaf does not", () => {
		const leaf = makeLeaf();
		const workspace = makeWorkspace({ leaves: [leaf] });
		const app = makeApp(workspace);

		firstCalendarLeaf(app).focus();

		expect(workspace.activated).toEqual([{ leaf, focus: true }]);
	});

	it("detaches only its own leaf, and the detached one stops being found", () => {
		const mine = makeLeaf();
		const other = makeLeaf();
		const workspace = makeWorkspace({ leaves: [mine, other] });
		const app = makeApp(workspace);

		firstCalendarLeaf(app).detach();

		expect(mine.attached).toBe(false);
		expect(other.attached).toBe(true);
		// find() returns the surviving leaf rather than the detached one.
		expect(new ObsidianCalendarLeafAdapter(app).find()).not.toBeNull();
	});
});

describe("ObsidianCalendarLeafAdapter", () => {
	it("finds nothing when no calendar leaf is open", () => {
		const app = makeApp(makeWorkspace());

		expect(new ObsidianCalendarLeafAdapter(app).find()).toBeNull();
	});

	it("finds nothing when a right-sidebar leaf exists but carries no calendar view", () => {
		const app = makeApp(makeWorkspace({ leaves: [makeLeaf({ viewState: null })] }));

		expect(new ObsidianCalendarLeafAdapter(app).find()).toBeNull();
	});

	it("walks create, find, reveal and focus as one sequence", async () => {
		// Start from the shape the plugin actually meets: a collapsed right
		// sidebar and no calendar leaf anywhere.
		const rightSplit = { collapsed: true };
		const workspace = makeWorkspace({
			rightSplit,
			rightLeafFactory: () => makeLeaf({ viewState: null, shown: false, root: rightSplit }),
		});
		const app = makeApp(workspace);
		const adapter = new ObsidianCalendarLeafAdapter(app);

		expect(adapter.find()).toBeNull();

		const created = await adapter.create();

		// Created inside a collapsed dock, so not yet on screen.
		expect(created.isVisible()).toBe(false);
		// The leaf the adapter just made is discoverable, which is what stops a
		// second call from creating another one.
		expect(adapter.find()).not.toBeNull();

		await created.reveal();

		expect(rightSplit.collapsed).toBe(false);
		expect(created.isVisible()).toBe(true);

		created.focus();

		expect(workspace.activated).toEqual([{ leaf: workspace.leaves[0], focus: true }]);
	});

	it("creates the leaf in the right sidebar and activates it", async () => {
		const workspace = makeWorkspace({
			rightLeafFactory: () => makeLeaf({ viewState: null }),
		});
		const app = makeApp(workspace);

		await new ObsidianCalendarLeafAdapter(app).create();

		expect(workspace.leaves[0]?.viewState).toEqual({
			type: VIEW_TYPE_CALENDAR,
			active: true,
		});
		expect(workspace.leaves[0]?.attached).toBe(true);
	});

	it("throws when the workspace offers no right sidebar leaf", async () => {
		const app = makeApp(makeWorkspace({ rightLeafFactory: null }));

		await expect(new ObsidianCalendarLeafAdapter(app).create()).rejects.toThrow(
			/no leaf for the right sidebar/,
		);
	});

	it("detaches the half-built leaf when the view fails to initialize", async () => {
		const workspace = makeWorkspace({
			rightLeafFactory: () => makeLeaf({ viewState: null, setViewStateFails: true }),
		});
		const app = makeApp(workspace);
		const adapter = new ObsidianCalendarLeafAdapter(app);

		await expect(adapter.create()).rejects.toThrow(/failed to initialize/);

		expect(workspace.leaves[0]?.attached).toBe(false);
		// The leaked pane is what AC-CMD-01.5 forbids: nothing is findable after.
		expect(adapter.find()).toBeNull();
	});
});
