import { App, SuggestModal } from "obsidian";
import type { PeriodSuggestion } from "../commands/datePhrase";
import type { LeafMode } from "../adapters/workspacePort";
import { isSplitModifierPressed } from "../notes/noteOpen";

export interface DateSwitcherDeps {
	suggest(query: string): PeriodSuggestion[];
	/** The name of the note a suggestion leads to, shown under its label. */
	noteName(item: PeriodSuggestion): string;
	open(item: PeriodSuggestion, mode: LeafMode): void;
	isMacOS: boolean;
}

/**
 * Type a date in words, confirm, and land on that period's note (US-CMD-10).
 *
 * A phrase that names no date leaves the list empty, so confirming does
 * nothing and the modal stays open showing `emptyStateText` (AC-CMD-10.5).
 */
export class DateSwitcherModal extends SuggestModal<PeriodSuggestion> {
	constructor(app: App, private deps: DateSwitcherDeps) {
		super(app);
		this.setPlaceholder("Type a date, like last monday or next week");
		this.emptyStateText = "Date not recognised.";
		this.setInstructions([
			{ command: "↵", purpose: "to open" },
			{ command: deps.isMacOS ? "⌘ ↵" : "ctrl ↵", purpose: "to open in a new pane" },
			{ command: "esc", purpose: "to dismiss" },
		]);
		// Mod is Cmd on macOS and Ctrl elsewhere, the split modifier
		// onChooseSuggestion reads. Plain Enter is the host's own binding.
		this.scope.register(["Mod"], "Enter", (evt) => {
			void this.selectActiveSuggestion(evt);
			return false;
		});
	}

	getSuggestions(query: string): PeriodSuggestion[] {
		return this.deps.suggest(query);
	}

	renderSuggestion(item: PeriodSuggestion, el: HTMLElement): void {
		el.createDiv({ text: item.label });
		el.createEl("small", { text: this.deps.noteName(item) });
	}

	onChooseSuggestion(item: PeriodSuggestion, evt: MouseEvent | KeyboardEvent): void {
		// Both event kinds carry metaKey and ctrlKey, which is all the check reads.
		const mode = isSplitModifierPressed(evt as MouseEvent, this.deps.isMacOS) ? "split" : "reuse";
		this.deps.open(item, mode);
	}
}
