import { App, Modal } from "obsidian";
import type { PeriodicNotesFieldId, PeriodicNotesImportField } from "./periodicNotesImport";

/**
 * Shows each value the import would overwrite next to the value the user already
 * has, and replaces only the ones ticked before "Import selected" (AC-MIG-04.4).
 *
 * ponytail: a near-twin of DailyNotesImportConflictModal rather than a shared
 * generic one. The two differ in their key type and in every line of copy, so
 * the abstraction would be a parameter per difference.
 */
export class PeriodicNotesImportConflictModal extends Modal {
	private conflicts: PeriodicNotesImportField[];
	private onConfirm: (confirmed: PeriodicNotesFieldId[]) => Promise<void>;

	constructor(
		app: App,
		conflicts: PeriodicNotesImportField[],
		onConfirm: (confirmed: PeriodicNotesFieldId[]) => Promise<void>,
	) {
		super(app);
		this.conflicts = conflicts;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Periodic notes import" });
		contentEl.createEl("p", {
			text: "Calendaric already has a value for these settings. Tick the ones you want to replace.",
		});

		const boxes = new Map<PeriodicNotesFieldId, HTMLInputElement>();
		for (const field of this.conflicts) {
			const row = contentEl.createEl("label", { cls: "calendaric-import-conflict" });
			const box = row.createEl("input", { type: "checkbox" });
			boxes.set(field.id, box);
			row.createEl("strong", { text: field.label });
			row.createSpan({ text: ` — yours: "${field.current}" · Periodic Notes: "${field.incoming}"` });
		}

		// Both listeners stay synchronous and void the promise, the way this
		// plugin's other click handlers do (src/ui/calendar.ts:86): an async
		// listener hands a promise to an API whose return type is void.
		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		buttons.createEl("button", { text: "Keep my values" }).addEventListener("click", () => {
			void this.confirm([]);
		});
		const importBtn = buttons.createEl("button", { text: "Import selected", cls: "mod-cta" });
		importBtn.addEventListener("click", () => {
			const confirmed = [...boxes.entries()].filter(([, box]) => box.checked).map(([id]) => id);
			void this.confirm(confirmed);
		});
	}

	private async confirm(confirmed: PeriodicNotesFieldId[]): Promise<void> {
		await this.onConfirm(confirmed);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
