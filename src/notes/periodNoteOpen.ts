import { RELEASE_GRANULARITIES } from "../types";
import type { PeriodicConfig, ReleaseGranularity } from "../types";
import type { NoteFile, VaultPort } from "../adapters/vaultPort";
import type { VaultConfigPort } from "../adapters/vaultConfigPort";
import type { WorkspacePort } from "../adapters/workspacePort";
import { computeNotePath } from "./noteUtils";
import { createPeriodicNote } from "./noteCreate";
import { openNoteIn } from "./noteOpen";
import { announceOverlaps, creationRefused } from "./predecessorGuard";

/** The date type, read off the clock Obsidian provides rather than imported (see main.ts). */
type Moment = ReturnType<typeof window.moment>;

/**
 * What a granularity command and the startup note do with one period's note:
 * open the note that is there, or write it -- unless a predecessor plugin
 * still writes these notes (AC-MIG-06.1). The calendar click has its own
 * version in `cellActions.ts`, because it also asks before writing.
 */

export interface PeriodNotePorts {
	vault: VaultPort;
	vaultConfig: VaultConfigPort;
	workspace: WorkspacePort;
}

/**
 * A command's "open this period's note". `existing` is what the index found:
 * a prefix-matched name or a frontmatter date can be the period's note without
 * sitting at the path the format would write.
 */
export async function openOrCreatePeriodNote(
	granularity: ReleaseGranularity,
	date: Moment,
	config: PeriodicConfig,
	existing: NoteFile | null,
	ports: PeriodNotePorts,
): Promise<void> {
	if (existing) {
		await openNoteIn(existing, "reuse", ports.workspace, existing.path);
		return;
	}

	// The refusal has already said which plugin still writes these notes.
	if (creationRefused(ports.vault, granularity)) return;

	const path = computeNotePath(date, config, ports.vaultConfig);
	let file: NoteFile;
	try {
		const creation = await createPeriodicNote(path, date, granularity, config, ports.vault, (message) =>
			ports.workspace.showNotice(message),
		);
		file = creation.file;
	} catch (error) {
		// Something else answers to the path, or the folder chain is unusable.
		// createPeriodicNote already names which, and the user gets that wording
		// rather than a silent no-op.
		ports.workspace.showNotice(error instanceof Error ? error.message : String(error));
		return;
	}

	await openNoteIn(file, "reuse", ports.workspace, path);
}

/**
 * Startup: say which predecessor still owns what (AC-MIG-06.2 -- nothing when
 * none does), then open the startup note in a new tab, writing it silently
 * when it is missing -- unless a predecessor owns it, which that notice has
 * already said.
 *
 * Quarter is reserved (DEC-23): a stored configuration may still carry it,
 * and it is skipped here exactly like a granularity that is switched off.
 * Every other granularity in the release set opens the same way, so a monthly
 * startup note is not silently dropped (AC-NOTE-04.2).
 */
export async function startUp(
	settings: Readonly<Record<ReleaseGranularity, PeriodicConfig>>,
	date: Moment,
	ports: PeriodNotePorts,
): Promise<void> {
	announceOverlaps(ports.vault);

	// Only one granularity can have openAtStartup (enforced by clearStartupNote).
	const key = RELEASE_GRANULARITIES.find((granularity) => settings[granularity].openAtStartup && settings[granularity].enabled);
	if (!key) return;
	const config = settings[key];

	const path = computeNotePath(date, config, ports.vaultConfig);
	let file = ports.vault.getFile(path);
	if (!file) {
		if (creationRefused(ports.vault, key, true)) return;
		// Created without asking: confirmBeforeCreate does not apply at startup.
		const creation = await createPeriodicNote(path, date, key, config, ports.vault, (message) =>
			ports.workspace.showNotice(message),
		);
		file = creation.file;
	}

	await openNoteIn(file, "tab", ports.workspace, path);
}
