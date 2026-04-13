import { App, Modal } from "obsidian";

interface ConfirmationModalParams {
	/** e.g. "New Daily Note" */
	title: string;
	/** e.g. "File 2026-04-13.md does not exist. Would you like to create it?" */
	body: string;
	onAccept: () => Promise<void>;
}

/**
 * Confirmation modal shown before creating a new periodic note.
 * Copied from calendar-plugin's ConfirmationModal structure.
 */
export class ConfirmationModal extends Modal {
	private params: ConfirmationModalParams;

	constructor(app: App, params: ConfirmationModalParams) {
		super(app);
		this.params = params;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: this.params.title });
		contentEl.createEl("p", { text: this.params.body });

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });

		buttons.createEl("button", { text: "Never mind" }).addEventListener("click", () => {
			this.close();
		});

		const createBtn = buttons.createEl("button", { text: "Create", cls: "mod-cta" });
		createBtn.addEventListener("click", async () => {
			await this.params.onAccept();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
