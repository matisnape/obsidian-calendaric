import type { App } from "obsidian";
import type { DesktopShellPort } from "./desktopShellPort";

/** This plugin's folder name under the vault's configuration directory. Matches manifest.json's id. */
const PLUGIN_ID = "obsidian-calendaric";

/**
 * The one module in the plugin holding a desktop-only API (AC-ARCH-01.6).
 *
 * Electron is reached through `window.require` rather than through an import,
 * so the bundle never carries it: esbuild lists "electron" as external, and on
 * mobile `window.require` is not there at all. `basePath` is the same story --
 * it is a field of the desktop file-system adapter and of nothing else, so a
 * vault open on a phone has no absolute path to give.
 *
 * Both absences are answered by doing nothing rather than by throwing, because
 * the only caller is a link inside a settings section that has already been
 * drawn.
 */
export class ElectronDesktopShellAdapter implements DesktopShellPort {
	constructor(private readonly app: App) {}

	openPluginFile(pluginRelativePath: string): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const basePath = (this.app.vault.adapter as any).basePath as string | undefined;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const load = (window as any).require as ((id: string) => unknown) | undefined;
		if (!basePath || typeof load !== "function") return;

		// The configuration folder is the user's to rename, so it is read rather
		// than spelled out.
		const folder = `${basePath}/${this.app.vault.configDir}/plugins/${PLUGIN_ID}`;
		const electron = load("electron") as { shell?: { openPath?: (path: string) => void } };
		electron.shell?.openPath?.(`${folder}/${pluginRelativePath}`);
	}
}
