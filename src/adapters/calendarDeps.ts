import type { VaultConfigPort } from "./vaultConfigPort";
import type { NoteFile, VaultIndexPort, VaultPort } from "./vaultPort";
import type { ReleaseGranularity } from "../types";
import type { WorkspacePort } from "./workspacePort";

/** Read off the clock Obsidian provides rather than imported (see main.ts). */
type Moment = ReturnType<typeof window.moment>;

/**
 * Every host capability the calendar pane uses, as one object.
 *
 * One object rather than one parameter per port: the pane is drawn by three
 * classes that pass the same set down to each other, so a fourth capability
 * added here changes no constructor signature. The lifecycle module builds it
 * (AC-ARCH-11.3); nothing below the view layer ever sees the implementations.
 *
 * `vault` carries both halves of the vault surface because the pane asks both
 * questions: whether a path holds a note, and what changed in the vault since
 * it last asked. `ObsidianVaultAdapter` and `FakeVaultPort` each implement both.
 */
export interface CalendarDeps {
	vault: VaultPort & VaultIndexPort;
	vaultConfig: VaultConfigPort;
	workspace: WorkspacePort;
	/**
	 * Which file is a period's note, answered by the plugin's one note index.
	 * The format's own path is not always that file: under prefix matching the
	 * note can carry more text after the date (AC-NOTE-07.6). Optional because
	 * a pane drawn without it still opens the note at the format's path.
	 */
	notes?: NoteLookup;
}

/** The one question the click path asks the note index. Null while it is not built. */
export interface NoteLookup {
	get(granularity: ReleaseGranularity, date: Moment): NoteFile | null;
}
