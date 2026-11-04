import type { NoteFile, VaultIndexPort, VaultPort, VaultWritePort } from "../adapters/vaultPort";
import type { FileGranularity } from "../fmt/resolveFileDate";
import type { PeriodicConfig } from "../types";
import type { PeriodicNoteIndex } from "./periodicNoteIndex";
import { substituteTemplateTokens } from "./templateTokens";

type ArrivalVault = Pick<VaultPort, "getTemplateFile" | "readFile"> & VaultIndexPort & VaultWritePort;

/** Which period a path is the note for: the index's own identification, not a second matcher. */
type PeriodLookup = Pick<PeriodicNoteIndex, "granularityOf" | "dateOf">;

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
	notes: PeriodLookup,
	config: (granularity: FileGranularity) => PeriodicConfig,
): () => void {
	return vault.onChange((change) => {
		if (change.kind === "create") void templateIfEmpty(change.file, vault, notes, config);
	});
}

async function templateIfEmpty(
	file: NoteFile,
	vault: ArrivalVault,
	notes: PeriodLookup,
	config: (granularity: FileGranularity) => PeriodicConfig,
): Promise<void> {
	// Every handler of this create runs before the line after this one, the
	// index's included, so the index has filed the path whichever subscribed first.
	await Promise.resolve();

	const granularity = notes.granularityOf(file.path);
	const date = notes.dateOf(file.path);
	if (granularity === null || date === null) return;

	const settings = config(granularity);
	// No template, or one that is not there: a manual file stays as it is, and
	// the user, who did not ask Calendaric for anything, is not told.
	const templateFile = settings.templatePath ? vault.getTemplateFile(settings.templatePath) : null;
	if (!templateFile) return;

	try {
		// The note before the template: most creates arrive with content,
		// Calendaric's own included, and must not cost a second expansion (AC-TPL-05).
		if ((await vault.readFile(file)) !== "") return;

		const title = file.path.split("/").pop()?.replace(/\.md$/, "") ?? "";
		const content = substituteTemplateTokens(await vault.readFile(templateFile), date, granularity, settings, title);
		if (content === "") return;

		// Checked again at write time: the user can type while the template is read.
		await vault.processFile(file, (current) => (current === "" ? content : current));
	} catch (error) {
		console.error(`Calendaric could not apply the template to: ${file.path}`, error);
	}
}
