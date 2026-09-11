import type { CalendarLeafHandle, CalendarLeafPort } from "./calendarLeafPort";

/** In-memory CalendarLeafHandle substitute for tests. */
export class FakeCalendarLeaf implements CalendarLeafHandle {
	visible = false;
	revealCount = 0;
	focusCount = 0;
	detached = false;
	revealFails = false;

	isVisible(): boolean {
		return this.visible && !this.detached;
	}

	async reveal(): Promise<void> {
		if (this.revealFails) throw new Error("workspace refused to reveal the calendar leaf");
		this.visible = true;
		this.revealCount += 1;
	}

	focus(): void {
		this.focusCount += 1;
	}

	detach(): void {
		this.detached = true;
	}
}

/** In-memory CalendarLeafPort substitute for tests — no running Obsidian required. */
export class FakeCalendarLeafPort implements CalendarLeafPort {
	leaf: FakeCalendarLeaf | null = null;
	created: FakeCalendarLeaf[] = [];
	createFails = false;

	/** Seed a leaf that predates the call under test. */
	withExistingLeaf(options: { visible: boolean }): FakeCalendarLeaf {
		const leaf = new FakeCalendarLeaf();
		leaf.visible = options.visible;
		this.leaf = leaf;
		return leaf;
	}

	find(): FakeCalendarLeaf | null {
		if (!this.leaf || this.leaf.detached) return null;
		return this.leaf;
	}

	async create(): Promise<FakeCalendarLeaf> {
		if (this.createFails) throw new Error("workspace refused the calendar leaf");
		const leaf = new FakeCalendarLeaf();
		this.leaf = leaf;
		this.created.push(leaf);
		return leaf;
	}
}
