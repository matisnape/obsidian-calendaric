/**
 * Leaf management for the calendar view, kept behind a port so the open/reveal
 * decision can be tested without a running Obsidian workspace.
 */
export interface CalendarLeafPort {
	/** True when at least one calendar leaf exists, collapsed sidebar included. */
	hasLeaf(): boolean;

	/**
	 * True when a calendar leaf is on screen. A leaf parked in a collapsed
	 * sidebar exists but is unreachable, so it does not count as visible.
	 */
	isVisible(): boolean;

	/** Create the calendar leaf. Throws when the workspace refuses. */
	create(): Promise<void>;

	/** Bring the existing calendar leaf forward, expanding its sidebar. */
	reveal(): Promise<void>;

	/** Detach every calendar leaf, used to clean up a half-created one. */
	discard(): void;
}
