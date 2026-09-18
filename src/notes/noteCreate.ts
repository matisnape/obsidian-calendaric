import type { Moment } from "moment";
import type { Granularity, PeriodicConfig, ReleaseGranularity } from "../types";
import { isReleaseGranularity } from "../types";
import type { FoldState, NoteFile, VaultPort } from "../adapters/vaultPort";
import { folderChainSegments, hasUnusableSegment } from "./noteUtils";
import { substituteTemplateTokens } from "./templateTokens";
import { validateTemplatePath } from "./validateTemplatePath";

/**
 * What a create request did, for a caller that has to act on it either way.
 *
 * `exists` is not a failure: the user asked for the note for a period and the
 * note for that period is right there, so the answer carries the file rather
 * than an error the caller would have to look the file up after (AC-NOTE-04.5).
 * Reaching for a period that is already written is the ordinary case, not the
 * exceptional one.
 */
export type NoteCreation =
	| { outcome: "created"; file: NoteFile }
	| { outcome: "exists"; file: NoteFile };

/**
 * Create the periodic note for one period, whatever its granularity.
 *
 * The one entry point for creating a note (DEC-12): every caller comes through
 * here, so there is a single place that decides what an occupied path means.
 * The old code answered that question three different ways in three call
 * sites, which is the whole of US-NOTE-04.
 *
 * Three answers, and only two of them are errors:
 *
 * - the note is already there      → `exists`, with the file, nothing written
 * - something else is already there → throws, naming the path
 * - the granularity is not in this release → throws, naming the granularity
 *
 * `createNote` below is the writing step this delegates to once those
 * questions are settled. It is exported for the tests that pin the folder and
 * template behaviour US-NOTE-03 and US-NOTE-05 settled; production code calls
 * this function.
 */
export async function createPeriodicNote(
	path: string,
	date: Moment,
	granularity: Granularity,
	config: PeriodicConfig,
	vault: VaultPort,
	warn: (message: string) => void,
): Promise<NoteCreation> {
	// First, and before the path is even looked at: a granularity this release
	// does not create notes for must leave the vault exactly as it found it.
	if (!isReleaseGranularity(granularity)) {
		throw new Error(
			`Calendaric cannot create a ${granularity} note: that granularity is not supported in this release.`,
		);
	}

	const existing = vault.getFile(path);
	if (existing) return { outcome: "exists", file: existing };

	// Not a note, yet something answers to the path — a folder, most often.
	// Writing would fail inside the vault with the vault's own wording, so the
	// refusal is made here where the path and the reason are both known.
	if (vault.pathExists(path)) {
		throw new Error(`Calendaric cannot create a note there: ${path} is not a Markdown note.`);
	}

	return { outcome: "created", file: await createNote(path, date, granularity, config, vault, warn) };
}

/**
 * Write a periodic note at the given path for the given date.
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
	granularity: ReleaseGranularity,
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
	granularity: ReleaseGranularity,
	config: PeriodicConfig,
	notePath: string,
	vault: VaultPort,
	warn: (message: string) => void,
): Promise<NoteTemplate> {
	if (!config.templatePath) return BLANK_NOTE;

	const unreadable = `Calendaric could not read the template: ${config.templatePath}`;
	const reportUnreadable = (): NoteTemplate => {
		warn(unreadable);
		return BLANK_NOTE;
	};

	const templateFile = vault.getTemplateFile(config.templatePath);
	if (!templateFile) {
		// A folder at the path is the case this warning could not express before
		// US-TPL-04: it reported every unresolved template the same way, which
		// sent anyone who had typed a folder path looking for a missing file
		// (AC-TPL-04.3). Anything else keeps the wording it has had since
		// US-NOTE-05, because a plain absent template is not what changed here.
		const problem = validateTemplatePath(config.templatePath, vault);
		warn(problem?.reason === "is-folder" ? problem.message : unreadable);
		return BLANK_NOTE;
	}

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
