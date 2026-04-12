import { App } from "obsidian";

interface InternalDailyNotesPlugin {
	enabled: boolean;
	instance?: {
		options?: {
			format?: string;
			folder?: string;
			template?: string;
		};
	};
	disable(confirm: boolean): void;
}

function getDailyNotesPlugin(app: App): InternalDailyNotesPlugin | null {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const plugin = (app as any).internalPlugins?.getPluginById("daily-notes") as InternalDailyNotesPlugin | undefined;
	return plugin ?? null;
}

export function isDailyNotesPluginEnabled(app: App): boolean {
	return getDailyNotesPlugin(app)?.enabled ?? false;
}

export function getLegacyDailyNoteSettings(app: App): { format: string; folder: string; template: string } {
	const plugin = getDailyNotesPlugin(app);
	const options = plugin?.instance?.options;
	return {
		format: options?.format ?? "",
		folder: options?.folder ?? "",
		template: options?.template ?? "",
	};
}

export function disableDailyNotesPlugin(app: App): void {
	getDailyNotesPlugin(app)?.disable(true);
}
