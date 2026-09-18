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

/**
 * Obsidian's `Setting` builds a small element tree inside the container and
 * exposes each part, which callers draw into: `descEl` in particular carries
 * more than the description string — US-TPL-04 renders the template problem
 * there.
 *
 * So the tree is real here rather than stubbed away. A stub that returned
 * `this` from every call let a settings section throw on `descEl` and be
 * swallowed by `renderGuardedSection`, which looks exactly like a field
 * choosing to report nothing.
 *
 * The `add*` callbacks stay unbuilt: no test reads a control back out, and the
 * controls are the part of the class with the most host behaviour behind them.
 * Only DOM tests construct a Setting -- the `createDiv`/`appendText` used here
 * are the extensions `installObsidianDom` patches on, so this class is usable
 * only under `@vitest-environment happy-dom`, which is where it is wanted.
 */
export class Setting {
	settingEl: HTMLElement;
	infoEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;

	constructor(container: HTMLElement) {
		this.settingEl = container.createDiv({ cls: "setting-item" });
		this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
		this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
		this.descEl = this.infoEl.createDiv({ cls: "setting-item-description" });
		this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
	}

	setName(name: string): this {
		this.nameEl.appendText(name);
		return this;
	}
	setDesc(desc: string): this {
		this.descEl.appendText(desc);
		return this;
	}
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

/**
 * The real one writes an SVG into the element. Nothing under test reads the
 * icon back, so a no-op is the whole stand-in -- what the settings tab needs is
 * that calling it does not throw.
 */
export function setIcon(_el: HTMLElement, _iconId: string): void {
	// Intentionally empty.
}

// The real Platform is read off the running host; tests that care inject their
// own flag through WorkspacePort.isMacOS instead of leaning on this default.
export const Platform = { isMacOS: false };
