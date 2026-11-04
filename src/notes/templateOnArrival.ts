import type { VaultConfigPort } from "../adapters/vaultConfigPort";
import type { NoteFile, VaultIndexPort, VaultPort, VaultWritePort } from "../adapters/vaultPort";
import type { FileGranularity } from "../fmt/resolveFileDate";
import type { PeriodicConfig } from "../types";
import { computeNotePath } from "./noteUtils";
import type { PeriodicNoteIndex } from "./periodicNoteIndex";
import { creationRefused } from "./predecessorGuard";
import { substituteTemplateTokens } from "./templateTokens";

type ArrivalVault = Pick<
	VaultPort,
	"backingVault" | "getTemplateFile" | "readFile" | "readFoldState" | "applyFoldState"
> &
	VaultIndexPort &
	VaultWritePort;

/** Which period a path is the note for: the index's own identification, not a second matcher. */
type PeriodLookup = Pick<PeriodicNoteIndex, "granularityOf" | "dateOf">;

type ConfigFor = (granularity: FileGranularity) => PeriodicConfig;

/**
 * Give an empty file that arrives as a period's note that period's template
 * (US-NOTE-10). Returns the unsubscribe.
 *
 * Every create counts, whoever made it: Calendaric's own create arrives here
 * too, already carrying its template, and the emptiness check leaves it alone.
 * A file the vault held before this subscription is never seen, so the caller
 * draws the startup line by choosing when to subscribe (DEC-13, AC-NOTE-10.3).
 */
export function templateOnArrival(
	vault: ArrivalVault,
	vaultConfig: VaultConfigPort,
	notes: PeriodLookup,
	config: ConfigFor,
): () => void {
	let stopped = false;
	const unsubscribe = vault.onChange((change) => {
		if (change.kind === "create") void templateIfEmpty(change.file, vault, vaultConfig, notes, config, () => stopped);
	});
	return () => {
		// A create already in flight must not write after the plugin is gone.
		stopped = true;
		unsubscribe();
	};
}

async function templateIfEmpty(
	file: NoteFile,
	vault: ArrivalVault,
	vaultConfig: VaultConfigPort,
	notes: PeriodLookup,
	config: ConfigFor,
	stopped: () => boolean,
): Promise<void> {
	// Every handler of this create runs before the line after this one, the
	// index's included, so the index has filed the path whichever subscribed first.
	await Promise.resolve();

	try {
		const granularity = notes.granularityOf(file.path);
		const date = notes.dateOf(file.path);
		if (granularity === null || date === null) return;
		// A predecessor that still owns the granularity templates its own notes, so
		// a second template would double it. Quietly: nobody asked Calendaric for this note.
		if (creationRefused(vault, granularity, true)) return;

		const settings = config(granularity);
		// The index also counts a note in a subfolder or under a prefix match;
		// only the exact path Calendaric would write is "directly in the folder,
		// named by the format" (AC-NOTE-10.1).
		if (computeNotePath(date, settings, vaultConfig, granularity) !== file.path) return;

		// No template, or one that is not there: a manual file stays as it is, and
		// the user, who did not ask Calendaric for anything, is not told.
		const templateFile = settings.templatePath ? vault.getTemplateFile(settings.templatePath) : null;
		if (!templateFile) return;

		// The note before the template: most creates arrive with content,
		// Calendaric's own included, and must not cost a second expansion (AC-TPL-05).
		if ((await vault.readFile(file)) !== "") return;

		const title = file.path.split("/").pop()?.replace(/\.md$/, "") ?? "";
		const content = substituteTemplateTokens(await vault.readFile(templateFile), date, granularity, settings, title);
		if (content === "" || stopped()) return;

		// Checked again at write time: the user can type while the template is read.
		let templated = false;
		await vault.processFile(file, (current) => {
			if (current !== "") return current;
			templated = true;
			return content;
		});

		// Only after this write placed the template: folds describe the template's
		// lines, and would fold the wrong text in a note the user typed into.
		const foldState = templated ? vault.readFoldState(templateFile) : null;
		if (foldState) await vault.applyFoldState(file, foldState);
	} catch (error) {
		console.error(`Calendaric could not apply the template to: ${file.path}`, error);
	}
}
