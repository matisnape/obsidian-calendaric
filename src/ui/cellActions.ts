import type { Moment } from "moment";
import type { HoverParent } from "obsidian";
import type { PeriodicConfig } from "../types";
import type { NoteFile, VaultPort } from "../adapters/vaultPort";
import type { VaultConfigPort } from "../adapters/vaultConfigPort";
import type { LeafMode, WorkspacePort } from "../adapters/workspacePort";
import { computeNotePath } from "../notes/noteUtils";
import { createNote } from "../notes/noteCreate";

/**
 * What a day or week cell does when the user clicks or hovers it.
 *
 * The decisions live here rather than in the DOM handler because a running
 * Obsidian is the only place a `<td>` exists: the handler in `calendar.ts`
 * reads the event and the cell, and everything that can go wrong — a note
 * created before the user agreed to it, a split that forgets to create first,
 * two clicks racing for the same new note — is settled by a test against the
 * ports.
 */

type Granularity = "day" | "week";

const GRANULARITY_LABEL: Record<Granularity, string> = {
	day: "daily",
	week: "weekly",
};

/** The id Obsidian's Page preview plugin knows this grid by. */
export const HOVER_LINK_SOURCE = "calendaric";

export interface CellPorts {
	vault: VaultPort;
	vaultConfig: VaultConfigPort;
	workspace: WorkspacePort;
}

/** The question the user answers before a missing note is written. */
export interface CreateRequest {
	title: string;
	body: string;
}

/** Answers a `CreateRequest`: true creates the note, false leaves the vault alone. */
export type ConfirmCreate = (request: CreateRequest) => Promise<boolean>;

export interface CellClick {
	date: Moment;
	granularity: Granularity;
	config: PeriodicConfig;
	confirmBeforeCreate: boolean;
	/** `Platform.isMacOS` — which modifier means "open in a split". */
	isMacOS: boolean;
	event: MouseEvent;
	ports: CellPorts;
	confirmCreate: ConfirmCreate;
}

/**
 * Whether a click asked for a split pane.
 *
 * The two modifiers are not interchangeable. On macOS a Ctrl-click is the
 * secondary click — the platform turns it into a context menu — so reading it
 * as Cmd would split a pane the user never asked for.
 *
 * Duplicates US-NOTE-06's `isMetaPressed`, which this stack cannot reach:
 * note-06 branches off master. Reconcile the two into one helper once both
 * have merged.
 */
export function splitModifierPressed(event: MouseEvent, isMacOS: boolean): boolean {
	return isMacOS ? event.metaKey : event.ctrlKey;
}

/**
 * Open the note a clicked cell stands for, creating it first when it is missing.
 *
 * The confirmation is asked through `confirmCreate` and not built here, because
 * the answer is the only thing this decision needs from the dialog.
 */
export async function openOrCreateNote(click: CellClick): Promise<void> {
	const { date, granularity, config, ports } = click;
	const path = computeNotePath(date, config, ports.vaultConfig);
	const mode: LeafMode = splitModifierPressed(click.event, click.isMacOS) ? "split" : "reuse";

	const existing = ports.vault.getFile(path);
	if (existing) {
		await ports.workspace.openInLeaf(existing, mode);
		return;
	}

	// Something that is not a note — a folder of the same name — already holds
	// the path. Creating would fail deep inside the vault, so say so instead.
	if (ports.vault.pathExists(path)) {
		throw new Error(`A folder already uses ${path}, so the note cannot be created there.`);
	}

	if (click.confirmBeforeCreate) {
		const accepted = await click.confirmCreate(describeCreate(date, granularity, path));
		if (!accepted) return;
	}

	const created = await createNoteOrJoinTheWinner(path, date, granularity, config, ports.vault);
	await ports.workspace.openInLeaf(created, mode);
}

/**
 * Create the note, or open the one that appeared while this click was working.
 *
 * Every route from the look to the write crosses an await — the confirmation
 * dialog, the template read — so a second click, a command, or the startup
 * note can write the file in between. Both activations asked for the same
 * note, so the loser opens the winner's file rather than reporting a failure
 * the user cannot act on. A failure that left nothing behind is a real one and
 * is rethrown.
 */
async function createNoteOrJoinTheWinner(
	path: string,
	date: Moment,
	granularity: Granularity,
	config: PeriodicConfig,
	vault: VaultPort,
): Promise<NoteFile> {
	try {
		return await createNoteInTurn(vault, path, () =>
			createNote(path, date, granularity, config, vault),
		);
	} catch (error) {
		const winner = vault.getFile(path);
		if (!winner) throw error;
		return winner;
	}
}

/**
 * The note creation currently in flight for each parent folder, per vault.
 *
 * Keyed by `backingVault` and not by the port, because the activations that
 * collide do not share a port either: every calendar pane builds its own
 * adapter over the same vault, so keying on the adapter gives each pane a
 * private queue and leaves them racing. The map is weak, so a vault that goes
 * away takes its entries with it.
 */
const folderWrites = new WeakMap<object, Map<string, Promise<NoteFile>>>();

/**
 * Write the note once the last note headed for the same folder is done.
 *
 * Re-reading the path after a failure does not cover this on its own, and
 * neither does coordinating per note path. `createNote` creates the missing
 * parent folder first and a vault rejects a folder that already exists, so two
 * activations aimed at the *same folder* — even at two different days — collide
 * there, and the loser fails before any note exists to fall back to.
 *
 * Taking turns per folder settles both shapes: the second activation finds the
 * folder already made, and when it wanted the very same note it fails on the
 * file instead, which the caller answers by opening what the winner wrote.
 * Serialising costs nothing a person would notice — these are clicks.
 */
async function createNoteInTurn(
	vault: VaultPort,
	path: string,
	write: () => Promise<NoteFile>,
): Promise<NoteFile> {
	let byFolder = folderWrites.get(vault.backingVault);
	if (!byFolder) {
		byFolder = new Map();
		folderWrites.set(vault.backingVault, byFolder);
	}
	const folders = byFolder;
	const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

	const previous = folders.get(folder);
	// Either arm starts this write: a predecessor that failed still leaves the
	// folder question answered, and its rejection belongs to its own caller.
	const mine = previous ? previous.then(write, write) : write();
	folders.set(folder, mine);

	const forget = (): void => {
		if (folders.get(folder) === mine) folders.delete(folder);
	};
	void mine.then(forget, forget);

	return await mine;
}

/**
 * Names the day, not only the filename: a format like `YYYY-MM-DD-ddd` or a
 * nested folder makes the name hard to read back as a date, and the user is
 * agreeing to a day rather than to a string.
 */
function describeCreate(date: Moment, granularity: Granularity, path: string): CreateRequest {
	const label = GRANULARITY_LABEL[granularity];
	const filename = path.split("/").pop() ?? path;
	const subject = granularity === "week" ? `The week of ${date.format("LL")}` : date.format("dddd, LL");

	return {
		title: `New ${label} note`,
		body: `${subject} has no ${label} note yet. Create ${filename}?`,
	};
}

/** The `hover-link` payload Obsidian's Page preview plugin listens for. */
export interface HoverPreviewRequest {
	event: MouseEvent;
	source: string;
	hoverParent: HoverParent;
	targetEl: HTMLElement;
	linktext: string;
	sourcePath: string;
}

/**
 * The preview to ask Obsidian for when a cell is hovered.
 *
 * Emitted on every hover, modifier or not: the Page preview plugin holds this
 * grid's own setting, registered with `defaultMod: true`, and reading the
 * modifier here would override whatever the user chose there.
 *
 * `linktext` is the note's path whether or not that file exists. An unresolved
 * link is exactly what makes Obsidian's own popover say the note is not there
 * yet, so the hover never reads the vault and can never write to it.
 */
export function hoverPreviewRequest(hover: {
	event: MouseEvent;
	hoverParent: HoverParent;
	targetEl: HTMLElement;
	notePath: string;
}): HoverPreviewRequest {
	return {
		event: hover.event,
		source: HOVER_LINK_SOURCE,
		hoverParent: hover.hoverParent,
		targetEl: hover.targetEl,
		linktext: hover.notePath,
		sourcePath: "",
	};
}
