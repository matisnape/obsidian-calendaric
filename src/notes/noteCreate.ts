import type { Moment } from "moment";
import type { PeriodicConfig } from "../types";
import type { NoteFile, VaultPort } from "../adapters/vaultPort";
import { folderChainSegments, hasUnusableSegment } from "./noteUtils";
import { substituteTemplateTokens } from "./templateTokens";

type Granularity = "day" | "week";

/**
 * Create a periodic note at the given path for the given date.
 * If a template is configured, its content is read and tokens substituted
 * before the file is created.
 *
 * Does NOT open the file — that's the caller's responsibility.
 * Does NOT compute the path — that's the caller's responsibility too, via
 * `computeNotePath`, which resolves the default-folder fallback through its
 * own VaultConfigPort rather than this function's VaultPort.
 */
export async function createNote(
	path: string,
	date: Moment,
	granularity: Granularity,
	config: PeriodicConfig,
	vault: VaultPort,
): Promise<NoteFile> {
	const folder = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
	await ensureFolderChain(folder, vault);

	const content = await buildNoteContent(date, granularity, config, path, vault);
	return await vault.createFile(path, content);
}

/**
 * Create every missing folder from the top of the chain down.
 *
 * Obsidian's `vault.createFolder` throws when the folder already exists, so
 * every segment is tested before it is created. Walking the chain explicitly
 * keeps the guarantee ours rather than resting on how one call treats missing
 * parents.
 *
 * Each await hands the event loop back, and two notes can be created at once —
 * both startup notes share a folder chain, and Sync writes folders of its own.
 * So the existence test can go stale before the call it guards, which makes a
 * failure on an existing folder the result we wanted rather than an error.
 */
async function ensureFolderChain(folder: string, vault: VaultPort): Promise<void> {
	// Refused before the first folder is made, so a rejected path never leaves
	// half a chain behind.
	if (hasUnusableSegment(folder)) {
		throw new Error(`Cannot create a folder for the path: ${folder}`);
	}

	for (const segment of folderChainSegments(folder)) {
		if (vault.folderExists(segment)) continue;

		try {
			await vault.createFolder(segment);
		} catch (error) {
			// Only a folder at this path means the race was won. Anything else
			// there — a file, say — leaves the chain broken, so the error stands.
			if (!vault.folderExists(segment)) throw error;
		}
	}
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
