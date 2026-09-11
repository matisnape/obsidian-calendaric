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
	/** The `active` intent of each create() call, in order. */
	createdActive: boolean[] = [];
	createFails = false;
	private createGate: Promise<void> | null = null;

	/**
	 * Hold create() open until the returned function is called.
	 *
	 * Without this a fake publishes its leaf in the same tick it is asked for
	 * one, so racing callers never both observe an empty workspace and a
	 * serialization test passes even when serialization is broken.
	 */
	deferCreation(): () => void {
		let release: () => void = () => undefined;
		this.createGate = new Promise<void>((resolve) => {
			release = resolve;
		});
		return release;
	}

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

	async create(options: { active: boolean }): Promise<FakeCalendarLeaf> {
		if (this.createGate) await this.createGate;
		if (this.createFails) throw new Error("workspace refused the calendar leaf");
		const leaf = new FakeCalendarLeaf();
		leaf.visible = options.active;
		this.leaf = leaf;
		this.created.push(leaf);
		this.createdActive.push(options.active);
		return leaf;
	}
}
