import type { Command } from "obsidian";

export interface DateSwitcherCommandDeps {
	available(): boolean;
	hasActiveLeaf(): boolean;
	open(): void;
}

/**
 * The palette entry for the date switcher (US-CMD-10). Registered always and
 * listed only while both checks hold, so turning the date plugin on or off
 * takes effect at the next palette open, with nothing to say either way
 * (AC-CMD-10.1, AC-CMD-10.2, AC-CMD-10.6).
 */
export function dateSwitcherCommand(deps: DateSwitcherCommandDeps): Command {
	return {
		id: "open-date-switcher",
		name: "Open date switcher",
		checkCallback: (checking) => {
			if (!deps.available() || !deps.hasActiveLeaf()) return false;
			if (!checking) deps.open();
			return true;
		},
	};
}
