// Minimal Obsidian mock for vitest — only what's needed by tested modules.

export class Plugin {}

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl: HTMLElement;
	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement("div");
	}
}

export class Setting {
	constructor(_container: HTMLElement) {}
	setName(_name: string): this { return this; }
	setDesc(_desc: string): this { return this; }
	addDropdown(_cb: (dd: unknown) => void): this { return this; }
	addToggle(_cb: (toggle: unknown) => void): this { return this; }
	addText(_cb: (text: unknown) => void): this { return this; }
	addButton(_cb: (btn: unknown) => void): this { return this; }
}

export class ItemView {
	leaf: unknown;
	constructor(leaf: unknown) {
		this.leaf = leaf;
	}
}

export class Modal {
	app: unknown;
	contentEl: HTMLElement;
	constructor(app: unknown) {
		this.app = app;
		this.contentEl = document.createElement("div");
	}
	open(): void {}
	close(): void {}
}

export class Notice {
	constructor(_message: string) {}
}

export class TFile {
	path = "";
}

/**
 * Minimal stand-in so `new Menu()` and `menu.showAtMouseEvent(...)` resolve
 * under test. Calendaric only builds the menu and hands it to the real
 * "file-menu" workspace event — populating it is the running Obsidian's job,
 * not this plugin's, so the fake tracks nothing beyond "it was shown".
 */
export class Menu {
	shownAtEvent: MouseEvent | null = null;

	showAtMouseEvent(evt: MouseEvent): this {
		this.shownAtEvent = evt;
		return this;
	}
}

// The real Platform is read off the running host; tests that care inject their
// own flag through WorkspacePort.isMacOS instead of leaning on this default.
export const Platform = { isMacOS: false };
