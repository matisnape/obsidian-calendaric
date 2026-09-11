import type { Moment } from "moment";
import type { PeriodicConfig } from "../types";
import type { NoteFile, VaultPort } from "../adapters/vaultPort";
import { substituteTemplateTokens } from "./templateTokens";

type Granularity = "day" | "week";

/**
 * Create a periodic note at the given path for the given date.
 * If a template is configured, its content is read and tokens substituted
 * before the file is created.
 *
 * Does NOT open the file — that's the caller's responsibility.
 * Does NOT compute the path — that's the caller's responsibility too, via
 * `computeNotePath`, since path computation is not vault decision logic.
 */
export async function createNote(
	path: string,
	date: Moment,
	granularity: Granularity,
	config: PeriodicConfig,
	vault: VaultPort,
): Promise<NoteFile> {
	const folder = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : null;
	if (folder && !vault.fileExists(folder)) {
		await vault.createFolder(folder);
	}

	const content = await buildNoteContent(date, granularity, config, path, vault);
	return await vault.createFile(path, content);
}

async function buildNoteContent(
	date: Moment,
	granularity: Granularity,
	config: PeriodicConfig,
	notePath: string,
	vault: VaultPort,
): Promise<string> {
	const title = notePath.split("/").pop()?.replace(/\.md$/, "") ?? "";

	if (!config.templatePath) return "";

	const templateFile = vault.getTemplateFile(config.templatePath);
	if (!templateFile) return "";

	const raw = await vault.readFile(templateFile);
	return substituteTemplateTokens(raw, date, granularity, config, title);
}
