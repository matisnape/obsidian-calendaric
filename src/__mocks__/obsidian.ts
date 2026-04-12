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
