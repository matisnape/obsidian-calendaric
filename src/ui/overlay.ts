export interface TriggerRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface Size {
	width: number;
	height: number;
}

export interface OverlayPosition {
	left: number;
	top: number;
}

/**
 * Where to put an overlay of `size` next to `trigger` so it stays inside
 * `viewport`: below the trigger, flipped above when only that fits, and
 * clamped to the window otherwise. An overlay larger than the window keeps its
 * top-left corner visible.
 */
export function placeOverlay(trigger: TriggerRect, size: Size, viewport: Size): OverlayPosition {
	let top = trigger.bottom;
	const fitsAbove = trigger.top - size.height >= 0;
	if (top + size.height > viewport.height && fitsAbove) top = trigger.top - size.height;
	if (top + size.height > viewport.height) top = viewport.height - size.height;
	if (top < 0) top = 0;

	let left = trigger.left;
	if (left + size.width > viewport.width) left = viewport.width - size.width;
	if (left < 0) left = 0;

	return { left, top };
}

export interface OverlayOptions {
	/** Called once, whatever closed the overlay. */
	onClose?: () => void;
	/** Makes it a list: arrow keys move focus between the elements this matches. */
	itemSelector?: string;
}

export interface OverlayHandle {
	close(): void;
}

/**
 * Shows `overlay` next to `trigger` and keeps it there until a click or tap
 * outside it, the trigger leaving the page or scrolling out of the window, or
 * `close()`. The page's own CSS must make `.calendaric-overlay` fixed-position:
 * only `left` and `top` are set here.
 */
export function openOverlay(trigger: HTMLElement, overlay: HTMLElement, options: OverlayOptions = {}): OverlayHandle {
	const doc = trigger.ownerDocument;
	const win = doc.defaultView;
	if (!win) throw new Error("openOverlay: the trigger's document has no window");

	const reposition = () => {
		const rect = trigger.getBoundingClientRect();
		const outOfView = rect.bottom <= 0 || rect.top >= win.innerHeight || rect.right <= 0 || rect.left >= win.innerWidth;
		if (outOfView) return close();
		const { width, height } = overlay.getBoundingClientRect();
		const pos = placeOverlay(rect, { width, height }, { width: win.innerWidth, height: win.innerHeight });
		overlay.style.left = `${pos.left}px`;
		overlay.style.top = `${pos.top}px`;
	};

	const onPointerDown = (event: Event) => {
		if (!overlay.contains(event.target as Node)) close();
	};

	const onKeyDown = (event: KeyboardEvent) => {
		const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
		if (!options.itemSelector || step === 0) return;
		const items = Array.from(overlay.querySelectorAll<HTMLElement>(options.itemSelector));
		if (items.length === 0) return;
		event.preventDefault();
		const current = items.indexOf(doc.activeElement as HTMLElement);
		const next = current === -1 ? (step === 1 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
		const item = items[next]!;
		if (!item.hasAttribute("tabindex")) item.tabIndex = -1;
		item.focus();
	};

	const observer = new win.MutationObserver(() => {
		if (!trigger.isConnected) close();
	});

	let open = true;
	const close = () => {
		if (!open) return;
		open = false;
		observer.disconnect();
		win.removeEventListener("scroll", reposition, true);
		win.removeEventListener("resize", reposition);
		doc.removeEventListener("pointerdown", onPointerDown, true);
		trigger.removeEventListener("keydown", onKeyDown);
		overlay.removeEventListener("keydown", onKeyDown);
		overlay.remove();
		options.onClose?.();
	};

	overlay.classList.add("calendaric-overlay");
	doc.body.appendChild(overlay);
	// Capture: `scroll` does not bubble, and the calendar scrolls inside a pane, not the window.
	win.addEventListener("scroll", reposition, true);
	win.addEventListener("resize", reposition);
	doc.addEventListener("pointerdown", onPointerDown, true);
	trigger.addEventListener("keydown", onKeyDown);
	overlay.addEventListener("keydown", onKeyDown);
	observer.observe(doc.body, { childList: true, subtree: true });
	reposition();

	return { close };
}
