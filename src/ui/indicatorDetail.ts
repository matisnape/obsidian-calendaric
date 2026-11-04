import type { CalendarIndicator, IndicatorCell, IndicatorContext } from "../indicatorContract";
import { openOverlay, type OverlayHandle } from "./overlay";

export const DETAIL_CLOSE_DELAY_MS = 250;
/** How long the pointer rests on a cell before its view opens, so a sweep across the grid opens none. */
export const DETAIL_OPEN_DELAY_MS = 200;

/** Detail view ids, unique across every calendar on the page. */
let detailIds = 0;

/**
 * Every indicator's line for `cell`, in drawing order. Empty means the cell has
 * no indicator data. One indicator that throws loses only its own line.
 */
export async function describeCell(
	indicators: readonly CalendarIndicator[],
	cell: IndicatorCell,
	context: IndicatorContext,
): Promise<string[]> {
	const lines = await Promise.all(
		indicators.map(async (indicator) => {
			try {
				return (await indicator.describe?.(cell, context)) ?? null;
			} catch (error) {
				console.error(`Calendaric: indicator "${indicator.id}" failed to describe a cell.`, error);
				return null;
			}
		}),
	);
	return lines.filter((line): line is string => Boolean(line));
}

/**
 * The detail view of one calendar's cells: shown on hover, on a touch tap and
 * on keyboard focus, one at a time.
 */
export class IndicatorDetail {
	private open: { cell: HTMLElement; view: HTMLElement; handle: OverlayHandle } | null = null;
	private closeTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Takes over `cell`'s click: `activate` is what a click on it does. A touch
	 * tap on a cell with data shows the detail first, and only a second tap, or
	 * the view's **Open note** button, calls `activate`.
	 */
	attach(cell: HTMLElement, lines: () => Promise<string[]>, activate: (event: MouseEvent) => void): void {
		// The pointer type of the press in progress, until its click, a cancel or a blur. The
		// focus a press gives the cell is not keyboard focus, and a touch press makes its click a tap.
		let pressedWith: string | null = null;
		// Focus that came from the keyboard: the pointer leaving the cell does not close its view.
		let keyboardFocus = false;
		// Bumped by every request and every dismissal, so a request that resolves late is dropped.
		let latest = 0;

		const request = async (withOpenButton: boolean): Promise<boolean> => {
			const ticket = ++latest;
			const text = await lines();
			if (ticket !== latest || text.length === 0 || !cell.isConnected) return false;
			this.show(cell, text, withOpenButton ? activate : undefined);
			return true;
		};
		const dismiss = () => {
			latest++;
			if (this.open?.cell === cell) this.close();
		};

		// Touch has no hover: its enter and leave come with every tap.
		cell.addEventListener("pointerenter", (event) => {
			if (event.pointerType === "touch") return;
			this.cancelClose();
			if (this.open?.cell === cell) return;
			const ticket = ++latest;
			setTimeout(() => {
				if (ticket === latest) void request(false);
			}, DETAIL_OPEN_DELAY_MS);
		});
		cell.addEventListener("pointerleave", (event) => {
			if (event.pointerType === "touch" || keyboardFocus) return;
			latest++;
			if (this.open?.cell === cell) this.scheduleClose();
		});
		cell.addEventListener("pointerdown", (event) => {
			pressedWith = event.pointerType;
		});
		cell.addEventListener("pointercancel", () => {
			pressedWith = null;
		});
		// A tap focuses the cell before its click; showing the view then would make that click open the note.
		cell.addEventListener("focus", () => {
			keyboardFocus = pressedWith === null;
			if (keyboardFocus && this.open?.cell !== cell) void request(false);
		});
		cell.addEventListener("blur", (event) => {
			pressedWith = null;
			keyboardFocus = false;
			// Focus moving onto the view's own button keeps it, or the tap on that button would miss.
			// No `instanceof Node`: in a popout window the node comes from that window's own globals.
			if (this.open?.cell === cell && this.open.view.contains(event.relatedTarget as Node | null)) return;
			dismiss();
		});
		cell.addEventListener("keydown", (event) => {
			if (event.key === "Escape") dismiss();
		});
		cell.addEventListener("click", (event) => {
			const touch = pressedWith === "touch";
			pressedWith = null;
			void (async () => {
				if (touch && this.open?.cell !== cell && (await request(true))) return;
				activate(event);
			})();
		});
	}

	close(): void {
		this.cancelClose();
		this.open?.handle.close();
	}

	private show(cell: HTMLElement, text: readonly string[], activate?: (event: MouseEvent) => void): void {
		this.close();
		const view = cell.ownerDocument.createElement("div");
		view.className = "calendaric-indicator-detail";
		view.id = `calendaric-indicator-detail-${++detailIds}`;
		view.setAttribute("role", "tooltip");
		for (const line of text) view.createDiv({ cls: "calendaric-indicator-detail-line", text: line });
		if (activate) {
			view.createEl("button", { text: "Open note" }).addEventListener("click", (event) => {
				this.close();
				activate(event);
			});
		}
		view.addEventListener("pointerenter", (event) => {
			if (event.pointerType !== "touch") this.cancelClose();
		});
		view.addEventListener("pointerleave", (event) => {
			if (event.pointerType !== "touch") this.scheduleClose();
		});

		cell.setAttribute("aria-describedby", view.id);
		const handle = openOverlay(cell, view, {
			// Also reached when the overlay closes itself, as on a re-render that detaches the cell.
			onClose: () => {
				cell.removeAttribute("aria-describedby");
				if (this.open?.view === view) this.open = null;
			},
		});
		this.open = { cell, view, handle };
	}

	private scheduleClose(): void {
		this.cancelClose();
		this.closeTimer = setTimeout(() => this.close(), DETAIL_CLOSE_DELAY_MS);
	}

	private cancelClose(): void {
		if (this.closeTimer !== null) clearTimeout(this.closeTimer);
		this.closeTimer = null;
	}
}
