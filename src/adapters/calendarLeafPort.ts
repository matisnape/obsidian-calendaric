/**
 * One calendar leaf that exists in the workspace right now.
 *
 * A handle, not a view type, because a rollback must remove the leaf this
 * invocation created and never a different one that happens to share the type.
 */
export interface CalendarLeafHandle {
	/**
	 * True when the leaf is actually on screen. A leaf behind another tab in the
	 * same dock, or inside a collapsed sidebar, exists but is unreachable.
	 */
	isVisible(): boolean;

	/** Bring the leaf forward, expanding its sidebar. */
	reveal(): Promise<void>;

	/** Give the leaf keyboard focus. */
	focus(): void;

	/** Remove this leaf, and only this leaf. */
	detach(): void;
}

/**
 * Leaf management for the calendar view, kept behind a port so the open/reveal
 * decision can be tested without a running Obsidian workspace.
 */
export interface CalendarLeafPort {
	/** The existing calendar leaf, or null when none is open. */
	find(): CalendarLeafHandle | null;

	/**
	 * Create the calendar leaf. Throws when the workspace refuses, and leaves
	 * nothing behind when it does.
	 */
	create(): Promise<CalendarLeafHandle>;
}
