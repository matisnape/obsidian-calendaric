/**
 * Handing a file to whatever the operating system opens it with.
 *
 * Desktop-only: neither the capability nor the Electron API behind it exists on
 * Obsidian mobile. The settings screen depends on this interface and on nothing
 * else, so the one module that does the reaching is the one named adapter
 * (AC-ARCH-01.6).
 */
export interface DesktopShellPort {
	/**
	 * Open a file that ships inside this plugin's own folder, named relative to
	 * that folder. Where the plugin folder IS -- which configuration directory
	 * holds it, and what the vault's absolute path is -- belongs to the host and
	 * is the adapter's business, not the caller's.
	 *
	 * Does nothing where the host cannot do it. A settings link that opens no
	 * window is a smaller failure than a settings tab that throws part-way
	 * through drawing itself, which is what the raw call does on a phone.
	 */
	openPluginFile(pluginRelativePath: string): void;
}
