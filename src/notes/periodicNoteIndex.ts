import type { Moment } from "moment";
import type { VaultConfigPort } from "../adapters/vaultConfigPort";
import type { NoteFile, VaultChange, VaultIndexPort } from "../adapters/vaultPort";
import type { FileConfigs, FileGranularity } from "../fmt/resolveFileDate";
import { resolveFileDate } from "../fmt/resolveFileDate";
import { computeNoteDate } from "../fmt/noteDate";
import { RELEASE_GRANULARITIES } from "../types";
import { resolveNoteFolder } from "./noteUtils";

/**
 * The granularities this index answers for, configured.
 *
 * Partial: an entry is what puts a granularity in the index at all, so the
 * caller switches one off by leaving it out rather than by passing a disabled
 * config the index would have to interpret.
 */
export type PeriodicConfigs = FileConfigs;

/** Which way a jump looks for the closest existing note. */
export type JumpDirection = "forward" | "backward";

/**
 * The format a frontmatter date is read against, per granularity.
 *
 * Deliberately not the configured format. A frontmatter date is what a
 * template or a script writes to say "this file is that period's note" when
 * the filename cannot say it, so it has to be readable without knowing how
 * this vault happens to name its files.
 */
const FRONTMATTER_FORMAT: Record<FileGranularity, string> = {
	day: "YYYY-MM-DD",
	week: "gggg-[W]ww",
	month: "YYYY-MM",
	year: "YYYY",
};

/**
 * The Monday inside the week `date` starts, which is that week's identity
 * whatever numbering named it.
 *
 * The default frontmatter week format numbers locale weeks, and a locale week
 * can start on a Sunday — a day that belongs to the previous ISO week. Left
 * alone it would file the note one week early. `parseFilename` walks the same
 * step for a locale-numbered filename, so the two agree on which week is which.
 */
function mondayWithin(date: Moment): Moment {
	return date.clone().add((1 - date.isoWeekday() + 7) % 7, "days");
}

/** One indexed note: the file, plus the path it was indexed under. */
interface IndexedNote {
	file: NoteFile;
	/**
	 * Held separately from `file.path` because a rename rewrites the path on
	 * the host's own file object. This one still says where the entry was
	 * filed, which is what a later `forget(oldPath)` has to match against.
	 */
	path: string;
}

/**
 * Which file is each period's note, kept current as the vault changes.
 *
 * The vault is read once, at construction; after that every create, delete,
 * rename and frontmatter change reported by the port updates the one entry it
 * touches. A lookup is a map read, so the features that ask per calendar cell
 * — dots, jump, open-or-create — never scan the vault.
 *
 * A settings change is the exception: `applySettings` throws the index away and
 * rebuilds it, because which files count is exactly what those settings decide
 * and an entry made under the old ones cannot be corrected in place.
 */
export class PeriodicNoteIndex {
	/** noteDate -> the note filed for that period. */
	private byNoteDate = new Map<string, IndexedNote>();
	/** path -> the noteDate it was filed under, so a change can find its entry. */
	private noteDateByPath = new Map<string, string>();
	private unsubscribe: () => void;

	constructor(
		private vault: VaultIndexPort,
		private vaultConfig: VaultConfigPort,
		private configs: PeriodicConfigs,
	) {
		this.unsubscribe = vault.onChange((change) => this.noticeChange(change));
		this.rebuild();
	}

	/** The note for that period, or null when the vault holds none. */
	get(granularity: FileGranularity, date: Moment): NoteFile | null {
		return this.byNoteDate.get(this.noteDateFor(granularity, date))?.file ?? null;
	}

	/**
	 * The nearest note before or after `date`'s own period, or null when the
	 * vault holds none that way.
	 *
	 * The period `date` sits in is never the answer: a jump that could land on
	 * the note the user is already looking at is not a jump, and "open this
	 * period" is a command of its own.
	 */
	closest(granularity: FileGranularity, date: Moment, direction: JumpDirection): NoteFile | null {
		return this.closestFrom(this.noteDateFor(granularity, date), direction);
	}

	/**
	 * The nearest note before or after the note at `path`, of that note's own
	 * granularity. Null when `path` is no periodic note, or none lies that way.
	 */
	closestTo(path: string, direction: JumpDirection): NoteFile | null {
		const noteDate = this.noteDateByPath.get(path);
		return noteDate === undefined ? null : this.closestFrom(noteDate, direction);
	}

	/** The granularity the note at `path` is filed under, or null when it is no periodic note. */
	granularityOf(path: string): FileGranularity | null {
		const noteDate = this.noteDateByPath.get(path);
		return noteDate === undefined ? null : (noteDate.slice(0, noteDate.indexOf(":")) as FileGranularity);
	}

	/**
	 * The start of the period the note at `path` is filed under, or null when it
	 * is no periodic note. Known for every note `granularityOf` names, a
	 * frontmatter-dated one included.
	 */
	dateOf(path: string): Moment | null {
		const noteDate = this.noteDateByPath.get(path);
		return noteDate === undefined ? null : window.moment(Number(noteDate.slice(noteDate.indexOf(":") + 1)));
	}

	/** The nearest note either side of the noteDate `origin`, within its granularity. */
	private closestFrom(origin: string, direction: JumpDirection): NoteFile | null {
		const prefix = origin.slice(0, origin.indexOf(":") + 1);
		const from = Number(origin.slice(prefix.length));
		let best: { at: number; file: NoteFile } | null = null;

		// ponytail: a linear pass over the index. This runs on a keypress, over a
		// map the vault's own note count bounds; a per-granularity sorted list is
		// the upgrade if a vault ever makes the scan measurable.
		for (const [noteDate, indexed] of this.byNoteDate) {
			if (!noteDate.startsWith(prefix)) continue;

			const at = Number(noteDate.slice(prefix.length));
			if (direction === "forward" ? at <= from : at >= from) continue;
			if (best === null || (direction === "forward" ? at < best.at : at > best.at)) {
				best = { at, file: indexed.file };
			}
		}

		return best?.file ?? null;
	}

	/** Every path currently indexed. For tests and for diagnosing a stale index. */
	paths(): string[] {
		return [...this.noteDateByPath.keys()];
	}

	/** Take the new configuration and rebuild: it decides which files count at all. */
	applySettings(configs: PeriodicConfigs): void {
		this.configs = configs;
		this.rebuild();
	}

	/** Stop listening. The index is dead after this; build another one. */
	destroy(): void {
		this.unsubscribe();
		this.unsubscribe = () => undefined;
	}

	private noticeChange(change: VaultChange): void {
		// Both ends of a rename: the entry the file had before, and whatever
		// was filed at the path it has landed on.
		if (change.oldPath !== undefined) this.forget(change.oldPath);
		this.forget(change.file.path);
		if (change.kind !== "delete") this.remember(change.file);
	}

	private rebuild(): void {
		this.byNoteDate.clear();
		this.noteDateByPath.clear();
		for (const file of this.vault.listNotes()) this.remember(file);
	}

	private remember(file: NoteFile): void {
		const noteDate = this.identify(file);
		if (noteDate === null) return;

		this.byNoteDate.set(noteDate, { file, path: file.path });
		this.noteDateByPath.set(file.path, noteDate);
	}

	private forget(path: string): void {
		const noteDate = this.noteDateByPath.get(path);
		if (noteDate === undefined) return;

		this.noteDateByPath.delete(path);
		// Two files can name one period and only the last one seen holds it, so
		// the entry goes only when this path is the one still filed there.
		if (this.byNoteDate.get(noteDate)?.path === path) this.byNoteDate.delete(noteDate);
	}

	/** Which period this file is the note for, by name first and frontmatter second. */
	private identify(file: NoteFile): string | null {
		const byName = resolveFileDate(file.path, this.configs, this.vaultConfig);
		if (byName) return byName.noteDate;

		return this.identifyByFrontmatter(file);
	}

	/**
	 * The period a file's frontmatter claims, when its name claims none.
	 *
	 * The folder still decides: a file outside every configured folder is not a
	 * periodic note however its frontmatter is written, which is the same rule
	 * `resolveFileDate` applies to a filename.
	 */
	private identifyByFrontmatter(file: NoteFile): string | null {
		// Narrowest period first, for the reason resolveFileDate gives: the more
		// specific period wins when a file could answer to either.
		for (const granularity of RELEASE_GRANULARITIES) {
			const config = this.configs[granularity];
			if (!config) continue;
			if (!this.isUnderFolder(file.path, config.folder)) continue;

			const written = this.vault.frontmatterString(file, granularity);
			if (written === null) continue;

			const date = window.moment(written, FRONTMATTER_FORMAT[granularity], true);
			if (!date.isValid()) continue;

			return this.noteDateFor(granularity, granularity === "week" ? mondayWithin(date) : date);
		}
		return null;
	}

	private isUnderFolder(path: string, folder: string): boolean {
		const resolved = resolveNoteFolder(folder, this.vaultConfig);
		return resolved === "" || path.startsWith(`${resolved}/`);
	}

	/**
	 * The identity string a period is filed under.
	 *
	 * The weekly format is passed even for a day, because it is what decides
	 * where a week starts — the same argument every other caller of
	 * `computeNoteDate` has to pass to agree with this index (AC-FMT-07.4).
	 */
	private noteDateFor(granularity: FileGranularity, date: Moment): string {
		return computeNoteDate(date, granularity, this.configs.week?.format ?? "");
	}
}
