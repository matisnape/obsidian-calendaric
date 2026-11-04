import { App, Modal } from "obsidian";
import type { CalendarImportField, CalendarImportFieldId } from "./calendarImport";

/**
 * Shows each customised week value next to the Calendar plugin's, and replaces
 * only the ones ticked before "Import selected" (AC-MIG-03.5).
 *
 * ponytail: a third near-twin of the Daily Notes and Periodic Notes conflict
 * modals; they differ in key type and copy, which a shared one would take as a
 * parameter each.
 */
export class CalendarImportConflictModal extends Modal {
	constructor(
		app: App,
		private conflicts: CalendarImportField[],
		private onConfirm: (confirmed: CalendarImportFieldId[]) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Calendar plugin import" });
		contentEl.createEl("p", {
			text: "Calendaric already has a value for these settings. Tick the ones you want to replace.",
		});

		const boxes = new Map<CalendarImportFieldId, HTMLInputElement>();
		for (const field of this.conflicts) {
			const row = contentEl.createEl("label", { cls: "calendaric-import-conflict" });
			const box = row.createEl("input", { type: "checkbox" });
			boxes.set(field.id, box);
			row.createEl("strong", { text: field.label });
			row.createSpan({ text: ` — yours: "${field.current}" · Calendar plugin: "${field.incoming}"` });
		}

		// Synchronous listeners that void the promise, as the other import modals do.
		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		buttons.createEl("button", { text: "Keep my values" }).addEventListener("click", () => {
			void this.confirm([]);
		});
		buttons.createEl("button", { text: "Import selected", cls: "mod-cta" }).addEventListener("click", () => {
			void this.confirm([...boxes.entries()].filter(([, box]) => box.checked).map(([id]) => id));
		});
	}

	private async confirm(confirmed: CalendarImportFieldId[]): Promise<void> {
		await this.onConfirm(confirmed);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
