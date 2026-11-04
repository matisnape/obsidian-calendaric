import type { VaultConfigPort } from "../adapters/vaultConfigPort";
import type { NoteFile, VaultIndexPort, VaultPort } from "../adapters/vaultPort";
import type { FileConfigs, FileGranularity } from "../fmt/resolveFileDate";
import { resolveFileDate } from "../fmt/resolveFileDate";
import { resolveNoteFolder } from "./noteUtils";

/**
 * Every note of one granularity in the vault, by filename alone.
 *
 * A file counts when `resolveFileDate` names this granularity for it, so a note
 * nested under the folder counts and a name that does not match the format does
 * not. Unlike `PeriodicNoteIndex`, a frontmatter date does not make a file count,
 * and two files naming the same period both come back.
 *
 * Throws when the granularity is not configured, or when its folder is missing:
 * an empty list there would read as "no notes yet". The vault root always exists.
 */
export function listPeriodicNotes(
	granularity: FileGranularity,
	configs: FileConfigs,
	vault: Pick<VaultPort, "folderExists"> & Pick<VaultIndexPort, "listNotes">,
	vaultConfig: VaultConfigPort,
): NoteFile[] {
	const config = configs[granularity];
	if (!config) {
		throw new Error(`Calendaric cannot list ${granularity} notes: that granularity is not configured.`);
	}

	const folder = resolveNoteFolder(config.folder, vaultConfig);
	if (folder !== "" && !vault.folderExists(folder)) {
		throw new Error(`Calendaric cannot list ${granularity} notes: the folder "${folder}" does not exist.`);
	}

	// All configs, not just this one: a file a narrower granularity claims is that
	// granularity's note, the same precedence every other lookup applies.
	return vault
		.listNotes()
		.filter((file) => resolveFileDate(file.path, configs, vaultConfig)?.granularity === granularity);
}
