import type { CalendarLeafPort } from "./calendarLeafPort";

/** In-memory CalendarLeafPort substitute for tests — no running Obsidian required. */
export class FakeCalendarLeafPort implements CalendarLeafPort {
	leafCount = 0;
	collapsed = false;
	revealCount = 0;
	createFails = false;
	revealFails = false;

	hasLeaf(): boolean {
		return this.leafCount > 0;
	}

	isVisible(): boolean {
		return this.leafCount > 0 && !this.collapsed;
	}

	async create(): Promise<void> {
		if (this.createFails) throw new Error("workspace refused the calendar leaf");
		this.leafCount += 1;
	}

	async reveal(): Promise<void> {
		if (this.revealFails) throw new Error("workspace refused to reveal the calendar leaf");
		this.collapsed = false;
		this.revealCount += 1;
	}

	discard(): void {
		this.leafCount = 0;
	}
}
