export interface NoteFile {
	path: string;
}

export interface VaultPort {
	pathExists(path: string): boolean;
	createFolder(path: string): Promise<void>;
	createFile(path: string, content: string): Promise<NoteFile>;
	readFile(file: NoteFile): Promise<string>;
	getTemplateFile(templatePath: string): NoteFile | null;
}
