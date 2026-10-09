import { App, Modal } from "obsidian";

/**
 * Asks before the core Daily Notes plugin is turned off (AC-MIG-02.1).
 * Only "Disable plugin" runs `onConfirm`; Cancel, Escape and the close button
 * leave the plugin as it is (AC-MIG-02.3).
 */
export class DisableDailyNotesModal extends Modal {
	private onConfirm: () => Promise<void>;

	constructor(app: App, onConfirm: () => Promise<void>) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Turn off the core daily notes plugin?" });
		contentEl.createEl("p", {
			text: "Calendaric will turn off the core daily notes plugin. Hotkeys bound to its commands may stop working.",
		});

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const disableBtn = buttons.createEl("button", { text: "Disable plugin", cls: "mod-warning" });
		disableBtn.addEventListener("click", () => {
			this.close();
			void this.onConfirm();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
