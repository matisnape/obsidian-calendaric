import type { Moment } from "moment";
import type { HoverParent } from "obsidian";
import type { PeriodicConfig } from "../types";
import type { VaultPort } from "../adapters/vaultPort";
import type { VaultConfigPort } from "../adapters/vaultConfigPort";
import type { WorkspacePort } from "../adapters/workspacePort";
import { computeNotePath } from "../notes/noteUtils";
import { createNote } from "../notes/noteCreate";
import { isMetaPressed, openNote } from "../notes/noteOpen";

/**
 * What a day or week cell does when the user clicks or hovers it.
 *
 * The decisions live here rather than in the DOM handler because a running
 * Obsidian is the only place a `<td>` exists: the handler in `calendar.ts`
 * reads the event and the cell, and everything that can go wrong — a note
 * created before the user agreed to it, a split that forgets to create first,
 * a hover that writes to the vault — is settled by a test against the ports.
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
	const { date, granularity, config, event, ports } = click;
	const path = computeNotePath(date, config, ports.vaultConfig);

	const existing = ports.vault.getFile(path);
	if (existing) {
		await openNote(existing, event, ports.workspace);
		return;
	}

	if (click.confirmBeforeCreate) {
		const accepted = await click.confirmCreate(describeCreate(date, granularity, path));
		if (!accepted) return;
	}

	const created = await createNote(path, date, granularity, config, ports.vault);
	await openNote(created, event, ports.workspace);
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
 * The preview to ask Obsidian for when a cell is hovered, or `null` while the
 * preview modifier is not held.
 *
 * `linktext` is the note's path whether or not that file exists. An unresolved
 * link is exactly what makes Obsidian's own popover say the note is not there
 * yet, so the hover never reads the vault and can never write to it.
 */
export function planHoverPreview(hover: {
	event: MouseEvent;
	hoverParent: HoverParent;
	targetEl: HTMLElement;
	notePath: string;
}): HoverPreviewRequest | null {
	if (!isMetaPressed(hover.event)) return null;

	return {
		event: hover.event,
		source: HOVER_LINK_SOURCE,
		hoverParent: hover.hoverParent,
		targetEl: hover.targetEl,
		linktext: hover.notePath,
		sourcePath: "",
	};
}
