import type { Moment } from "moment";
import type { PeriodicConfig } from "../types";
import type { FoldState, NoteFile, VaultPort } from "../adapters/vaultPort";
import { folderChainSegments, hasUnusableSegment } from "./noteUtils";
import { substituteTemplateTokens } from "./templateTokens";

type Granularity = "day" | "week";

/**
 * Create a periodic note at the given path for the given date.
 * If a template is configured, its content is read and tokens substituted
 * before the file is created.
 *
 * `warn` carries a template problem to wherever the user can see it. It is
 * required rather than optional because a caller that forgets it turns a
 * template the user configured into a silently blank note.
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
	warn: (message: string) => void,
): Promise<NoteFile> {
	const folder = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
	await ensureFolderChain(folder, vault);

	const template = await readTemplate(date, granularity, config, path, vault, warn);
	const file = await vault.createFile(path, template.content);

	// The fold state describes lines, so it can only be attached once those lines
	// exist as a file. By then the note is already the user's — a failure here
	// must not reject, or the caller never gets the file back to open it.
	if (template.foldState) {
		try {
			await vault.applyFoldState(file, template.foldState);
		} catch (error) {
			console.error(`Calendaric could not apply the template's fold state to: ${path}`, error);
		}
	}

	return file;
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

interface NoteTemplate {
	content: string;
	foldState: FoldState | null;
}

/** What a note starts from when no template applies: nothing, and no folds. */
const BLANK_NOTE: NoteTemplate = { content: "", foldState: null };

/**
 * Read the configured template and expand its tokens.
 *
 * Every way the template can fail to arrive ends in a blank note rather than a
 * rejection, because the note is the thing the user asked for and the template
 * is a convenience on top of it. A missing configuration is silent; a template
 * that was configured and then could not be read is the case the user has to
 * hear about, so it warns and names the path it tried.
 */
async function readTemplate(
	date: Moment,
	granularity: Granularity,
	config: PeriodicConfig,
	notePath: string,
	vault: VaultPort,
	warn: (message: string) => void,
): Promise<NoteTemplate> {
	if (!config.templatePath) return BLANK_NOTE;

	const reportUnreadable = (): NoteTemplate => {
		warn(`Calendaric could not read the template: ${config.templatePath}`);
		return BLANK_NOTE;
	};

	const templateFile = vault.getTemplateFile(config.templatePath);
	if (!templateFile) return reportUnreadable();

	const title = notePath.split("/").pop()?.replace(/\.md$/, "") ?? "";

	try {
		const raw = await vault.readFile(templateFile);
		return {
			content: substituteTemplateTokens(raw, date, granularity, config, title),
			foldState: readFoldState(templateFile, vault),
		};
	} catch (error) {
		// The vault named the file and then refused it — deleted between the two
		// calls, or unreadable. The reason only reaches the console; the user gets
		// the note and the warning.
		console.error(`Calendaric could not read the template: ${config.templatePath}`, error);
		return reportUnreadable();
	}
}

/**
 * The template's fold state, or none when it cannot be read.
 *
 * Kept out of the content read so that a fold store which refuses to answer
 * costs the note its folds and nothing else. Folds are a convenience on top of
 * the content, and the user is not told, because the template they configured
 * did arrive.
 */
function readFoldState(templateFile: NoteFile, vault: VaultPort): FoldState | null {
	try {
		return vault.readFoldState(templateFile);
	} catch (error) {
		console.error(`Calendaric could not read the fold state of: ${templateFile.path}`, error);
		return null;
	}
}
