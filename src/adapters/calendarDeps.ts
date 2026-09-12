import type { VaultConfigPort } from "./vaultConfigPort";
import type { VaultIndexPort, VaultPort } from "./vaultPort";
import type { WorkspacePort } from "./workspacePort";

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
}
