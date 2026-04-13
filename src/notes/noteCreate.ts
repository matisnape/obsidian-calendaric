import type { Moment } from "moment";
import type { App, TFile } from "obsidian";
import type { PeriodicConfig } from "../types";
import { computeNotePath } from "./noteUtils";
import { substituteTemplateTokens } from "./templateTokens";

type Granularity = "day" | "week";

/**
 * Create a periodic note at the computed path for the given date.
 * If a template is configured, its content is read and tokens substituted
 * before the file is created.
 *
 * Does NOT open the file — that's the caller's responsibility.
 */
export async function createNote(
	date: Moment,
	granularity: Granularity,
	config: PeriodicConfig,
	app: App,
): Promise<TFile> {
	const path = computeNotePath(date, config, app);

	// Ensure parent folder exists
	const folder = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : null;
	if (folder) {
		const folderExists = app.vault.getAbstractFileByPath(folder);
		if (!folderExists) {
			await app.vault.createFolder(folder);
		}
	}

	const content = await buildNoteContent(date, granularity, config, path, app);
	return await app.vault.create(path, content);
}

async function buildNoteContent(
	date: Moment,
	granularity: Granularity,
	config: PeriodicConfig,
	notePath: string,
	app: App,
): Promise<string> {
	const title = notePath.split("/").pop()?.replace(/\.md$/, "") ?? "";

	if (!config.templatePath) return "";

	const templateFile = app.metadataCache.getFirstLinkpathDest(config.templatePath, "");
	if (!templateFile) return "";

	const raw = await app.vault.read(templateFile);
	return substituteTemplateTokens(raw, date, granularity, config, title);
}
