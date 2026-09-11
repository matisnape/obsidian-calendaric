import { App, Modal } from "obsidian";

interface ConfirmationModalParams {
	/** e.g. "New daily note" */
	title: string;
	/** e.g. "Monday, April 13, 2026 has no daily note yet. Create 2026-04-13.md?" */
	body: string;
	onAccept: () => Promise<void>;
	/** Called when the modal closes unaccepted, so a caller waiting on the answer gets one. */
	onDismiss?: () => void;
}

/**
 * Confirmation modal shown before creating a new periodic note.
 * Copied from calendar-plugin's ConfirmationModal structure.
 */
export class ConfirmationModal extends Modal {
	private params: ConfirmationModalParams;
	private accepted = false;

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
			// Set before the await: closing mid-accept must not read as a dismissal.
			this.accepted = true;
			await this.params.onAccept();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.accepted) this.params.onDismiss?.();
	}
}
