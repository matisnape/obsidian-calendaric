import type { VaultPort } from "../adapters/vaultPort";

/**
 * Why a configured template path is not usable.
 *
 * `not-found` is nothing resolving at the path; `is-folder` is something
 * resolving and being the wrong kind of thing. They are kept apart because the
 * user's next move differs (AC-TPL-04.3): a folder means the name is already
 * taken in the vault, so telling them it was not found sends them looking for
 * a file that is there under that name.
 */
export type TemplateProblemReason = "not-found" | "is-folder";

export interface TemplatePathProblem {
	reason: TemplateProblemReason;
	/**
	 * The problem in the user's words, ready to show where the path was typed.
	 *
	 * Carried next to `reason` rather than instead of it because the two
	 * surfaces that report a template problem word it differently: this text is
	 * for configuration time, while the note-creation warning keeps the wording
	 * it has had since US-NOTE-05 and branches on `reason` instead.
	 */
	message: string;
}

/**
 * Check a configured template path, or null when there is nothing to report.
 *
 * Emptiness is tested exactly the way `readTemplate` tests it — falsy, not
 * trimmed — because the two have to agree about what "no template" means. A
 * validator that forgave `"   "` while `readTemplate` warned about it would
 * call the path clean and then warn on the next note created from it.
 */
export function validateTemplatePath(templatePath: string, vault: VaultPort): TemplatePathProblem | null {
	// No template is a valid configuration, not a mistake: a template is
	// optional per granularity (AC-TPL-04.4).
	if (!templatePath) return null;

	// Resolved through the same call that will later read it, so validation
	// cannot pass a path the read then fails to find (AC-TPL-04.1).
	if (vault.getTemplateFile(templatePath)) return null;

	// Asked only once the file lookup has already failed: a note and a folder
	// cannot share one path, so this orders the two answers rather than racing
	// them (AC-TPL-04.3).
	if (vault.folderExists(templatePath)) {
		return {
			reason: "is-folder",
			message: `Calendaric cannot use the template: ${templatePath} is a folder, not a note.`,
		};
	}

	// AC-TPL-04.2
	return {
		reason: "not-found",
		message: `Calendaric could not find the template: ${templatePath} was not found in the vault.`,
	};
}
