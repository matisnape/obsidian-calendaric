/** The one piece of vault config decision logic reads: the default new-file folder fallback. */
export interface VaultConfigPort {
	getDefaultNewFileFolder(): string;
}
