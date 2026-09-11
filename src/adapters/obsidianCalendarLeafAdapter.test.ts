import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { ObsidianCalendarLeafAdapter } from "./obsidianCalendarLeafAdapter";
import type { CalendarLeafHandle } from "./calendarLeafPort";
import { VIEW_TYPE_CALENDAR } from "../ui/viewType";

interface FakeLeaf {
	shown: boolean;
	root: unknown;
	detached: boolean;
	viewState: unknown;
	setViewStateFails: boolean;
}

interface FakeWorkspace {
	leaves: FakeLeaf[];
	rightLeaf: FakeLeaf | null;
	leftSplit: { collapsed: boolean };
	rightSplit: { collapsed: boolean };
	revealed: FakeLeaf[];
	activated: { leaf: FakeLeaf; focus: boolean | undefined }[];
}

function makeLeaf(overrides: Partial<FakeLeaf> = {}): FakeLeaf {
	return {
		shown: true,
		root: null,
		detached: false,
		viewState: null,
		setViewStateFails: false,
		...overrides,
	};
}

// Structural App fixture. The parts this adapter touches — isShown(),
// getRoot(), the sidedock collapsed flag — are DOM and layout state that no
// headless test environment provides, so they are pinned here instead.
function makeApp(workspace: FakeWorkspace): App {
	const api = {
		workspace: {
			leftSplit: workspace.leftSplit,
			rightSplit: workspace.rightSplit,
			getLeavesOfType: (type: string) =>
				type === VIEW_TYPE_CALENDAR ? workspace.leaves.map(wrap) : [],
			getRightLeaf: () => (workspace.rightLeaf ? wrap(workspace.rightLeaf) : null),
			revealLeaf: async (leaf: { fake: FakeLeaf }) => {
				workspace.revealed.push(leaf.fake);
			},
			setActiveLeaf: (leaf: { fake: FakeLeaf }, params?: { focus?: boolean }) => {
				workspace.activated.push({ leaf: leaf.fake, focus: params?.focus });
			},
		},
	};

	function wrap(fake: FakeLeaf) {
		return {
			fake,
			view: { containerEl: { isShown: () => fake.shown } },
			getRoot: () => fake.root,
			detach: () => {
				fake.detached = true;
			},
			setViewState: async (state: unknown) => {
				if (fake.setViewStateFails) throw new Error("view failed to initialize");
				fake.viewState = state;
			},
		};
	}

	return api as unknown as App;
}

function makeWorkspace(overrides: Partial<FakeWorkspace> = {}): FakeWorkspace {
	return {
		leaves: [],
		rightLeaf: null,
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
		const workspace = makeWorkspace({ leaves: [leaf] });
		const app = makeApp(workspace);

		expect(firstCalendarLeaf(app).isVisible()).toBe(false);
	});

	it("is false when the leaf sits in a collapsed right sidebar", () => {
		const rightSplit = { collapsed: true };
		const leaf = makeLeaf({ root: rightSplit });
		const workspace = makeWorkspace({ leaves: [leaf], rightSplit });
		const app = makeApp(workspace);

		expect(firstCalendarLeaf(app).isVisible()).toBe(false);
	});

	it("is false when the leaf sits in a collapsed left sidebar", () => {
		const leftSplit = { collapsed: true };
		const leaf = makeLeaf({ root: leftSplit });
		const workspace = makeWorkspace({ leaves: [leaf], leftSplit });
		const app = makeApp(workspace);

		expect(firstCalendarLeaf(app).isVisible()).toBe(false);
	});

	it("is true when the leaf sits in an expanded sidebar", () => {
		const rightSplit = { collapsed: false };
		const leaf = makeLeaf({ root: rightSplit });
		const workspace = makeWorkspace({ leaves: [leaf], rightSplit });
		const app = makeApp(workspace);

		expect(firstCalendarLeaf(app).isVisible()).toBe(true);
	});

	it("is true for a shown leaf in the editor area, which has no sidebar", () => {
		const leaf = makeLeaf({ root: { notASidedock: true } });
		const workspace = makeWorkspace({ leaves: [leaf] });
		const app = makeApp(workspace);

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

	it("detaches only its own leaf", () => {
		const mine = makeLeaf();
		const other = makeLeaf();
		const workspace = makeWorkspace({ leaves: [mine, other] });
		const app = makeApp(workspace);

		firstCalendarLeaf(app).detach();

		expect(mine.detached).toBe(true);
		expect(other.detached).toBe(false);
	});
});

describe("ObsidianCalendarLeafAdapter", () => {
	it("finds nothing when no calendar leaf is open", () => {
		const app = makeApp(makeWorkspace());

		expect(new ObsidianCalendarLeafAdapter(app).find()).toBeNull();
	});

	it("creates the leaf in the right sidebar and activates it", async () => {
		const rightLeaf = makeLeaf();
		const workspace = makeWorkspace({ rightLeaf });
		const app = makeApp(workspace);

		await new ObsidianCalendarLeafAdapter(app).create();

		expect(rightLeaf.viewState).toEqual({ type: VIEW_TYPE_CALENDAR, active: true });
		expect(rightLeaf.detached).toBe(false);
	});

	it("throws when the workspace offers no right sidebar leaf", async () => {
		const app = makeApp(makeWorkspace({ rightLeaf: null }));

		await expect(new ObsidianCalendarLeafAdapter(app).create()).rejects.toThrow(
			/no leaf for the right sidebar/,
		);
	});

	it("detaches the half-built leaf when the view fails to initialize", async () => {
		const rightLeaf = makeLeaf({ setViewStateFails: true });
		const workspace = makeWorkspace({ rightLeaf });
		const app = makeApp(workspace);

		await expect(new ObsidianCalendarLeafAdapter(app).create()).rejects.toThrow(
			/failed to initialize/,
		);
		expect(rightLeaf.detached).toBe(true);
	});
});
