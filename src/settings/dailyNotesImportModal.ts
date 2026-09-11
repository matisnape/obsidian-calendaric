import { App, Modal } from "obsidian";
import type { DailyNotesImportField, DailyNotesImportKey } from "./dailyNotesImport";

/**
 * Shows each value the import would overwrite next to the value the user already
 * has, and replaces only the ones ticked before "Import selected" (AC-MIG-01.5).
 */
export class DailyNotesImportConflictModal extends Modal {
	private conflicts: DailyNotesImportField[];
	private onConfirm: (confirmed: DailyNotesImportKey[]) => Promise<void>;

	constructor(
		app: App,
		conflicts: DailyNotesImportField[],
		onConfirm: (confirmed: DailyNotesImportKey[]) => Promise<void>,
	) {
		super(app);
		this.conflicts = conflicts;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Daily Notes import" });
		contentEl.createEl("p", {
			text: "These settings already have a value in Calendaric. Tick the ones you want to replace with the Daily Notes value.",
		});

		const boxes = new Map<DailyNotesImportKey, HTMLInputElement>();
		for (const field of this.conflicts) {
			const row = contentEl.createEl("label", { cls: "calendaric-import-conflict" });
			const box = row.createEl("input", { type: "checkbox" });
			boxes.set(field.key, box);
			row.createEl("strong", { text: field.label });
			row.createSpan({ text: ` — yours: "${field.current}" · Daily Notes: "${field.incoming}"` });
		}

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		buttons.createEl("button", { text: "Keep my values" }).addEventListener("click", async () => {
			await this.onConfirm([]);
			this.close();
		});
		const importBtn = buttons.createEl("button", { text: "Import selected", cls: "mod-cta" });
		importBtn.addEventListener("click", async () => {
			const confirmed = [...boxes.entries()].filter(([, box]) => box.checked).map(([key]) => key);
			await this.onConfirm(confirmed);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
