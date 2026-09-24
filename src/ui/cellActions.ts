import type { Moment } from "moment";
import type { HoverParent } from "obsidian";
import type { PeriodicConfig, ReleaseGranularity } from "../types";
import type { NoteFile, VaultPort } from "../adapters/vaultPort";
import type { VaultConfigPort } from "../adapters/vaultConfigPort";
import type { WorkspacePort } from "../adapters/workspacePort";
import { computeNotePath } from "../notes/noteUtils";
import { createPeriodicNote } from "../notes/noteCreate";
import { openNote } from "../notes/noteOpen";
import { creationRefused } from "../notes/predecessorGuard";

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

/** The granularities a calendar cell stands for: the release set minus year. */
type CellGranularity = Exclude<ReleaseGranularity, "year">;

const GRANULARITY_LABEL: Record<CellGranularity, string> = {
	day: "daily",
	week: "weekly",
	month: "monthly",
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
	granularity: CellGranularity;
	config: PeriodicConfig;
	confirmBeforeCreate: boolean;
	event: MouseEvent;
	ports: CellPorts;
	confirmCreate: ConfirmCreate;
}

/**
 * Open the note a clicked cell stands for, creating it first when it is missing.
 *
 * The confirmation is asked through `confirmCreate` and not built here, because
 * the answer is the only thing this decision needs from the dialog.
 */
export async function openOrCreateNote(click: CellClick): Promise<void> {
	const { date, granularity, config, ports } = click;
	const path = computeNotePath(date, config, ports.vaultConfig, granularity);

	const existing = ports.vault.getFile(path);
	if (existing) {
		// `openNote` decides the destination from the platform's split modifier,
		// which the workspace port knows and this function does not.
		await openNote(existing, click.event, ports.workspace, path);
		return;
	}

	// Before the confirmation: a note Calendaric will not write is not worth
	// asking about. The refusal has already told the user which plugin still
	// writes this granularity (AC-MIG-06.1).
	if (creationRefused(ports.vault, granularity)) return;

	if (click.confirmBeforeCreate) {
		const accepted = await click.confirmCreate(describeCreate(date, granularity, path));
		if (!accepted) return;
	}

	// A template that cannot be read still yields a note, so the only way the user
	// learns about it is a notice, and notices ride the workspace port.
	const created = await createNoteOrJoinTheWinner(path, date, granularity, config, ports.vault, (message) =>
		ports.workspace.showNotice(message),
	);
	await openNote(created, click.event, ports.workspace, path);
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
	granularity: CellGranularity,
	config: PeriodicConfig,
	vault: VaultPort,
	warn: (message: string) => void,
): Promise<NoteFile> {
	try {
		return await createNoteInTurn(vault, path, async () => {
			// Either outcome is the note this click asked for: `exists` is the
			// note someone wrote first, and it opens exactly like a new one.
			const creation = await createPeriodicNote(path, date, granularity, config, vault, warn);
			return creation.file;
		});
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
 * neither does coordinating per note path. `createPeriodicNote` creates the missing
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
function describeCreate(date: Moment, granularity: CellGranularity, path: string): CreateRequest {
	const label = GRANULARITY_LABEL[granularity];
	const filename = path.split("/").pop() ?? path;
	const subject = subjectFor(granularity, date);

	return {
		title: `New ${label} note`,
		body: `${subject} has no ${label} note yet. Create ${filename}?`,
	};
}

/**
 * Names the period the way a person would read it back, not just its filename.
 *
 * A plain switch rather than a record: `noImplicitReturns` fails the build if a
 * future granularity lands here without a case, which is what keeps this in
 * step with `GRANULARITY_LABEL` above.
 */
function subjectFor(granularity: CellGranularity, date: Moment): string {
	switch (granularity) {
		case "week":
			return `The week of ${date.format("LL")}`;
		case "month":
			return `The month of ${date.format("MMMM YYYY")}`;
		case "day":
			return date.format("dddd, LL");
	}
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
