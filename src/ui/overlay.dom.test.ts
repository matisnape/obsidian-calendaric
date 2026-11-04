// @vitest-environment happy-dom
//
// US-CAL-12: the overlay controller, driven by the DOM events a user produces.
// happy-dom does no layout, so every rect the controller reads is stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openOverlay } from "./overlay";

type Box = { left: number; top: number; width: number; height: number };

const stubRect = (el: HTMLElement, box: Box) => {
	el.getBoundingClientRect = () =>
		({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height }) as DOMRect;
};

// MutationObserver callbacks run as a microtask.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let scroller: HTMLElement;
let trigger: HTMLElement;
let overlay: HTMLElement;
let outside: HTMLElement;

beforeEach(() => {
	// happy-dom's default window is 1024 x 768.
	scroller = document.body.appendChild(document.createElement("div"));
	trigger = scroller.appendChild(document.createElement("div"));
	outside = document.body.appendChild(document.createElement("div"));
	overlay = document.createElement("div");
	stubRect(trigger, { left: 100, top: 100, width: 40, height: 20 });
	stubRect(overlay, { left: 0, top: 0, width: 200, height: 100 });
});

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

const pointerDown = (target: Element) => target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
const arrow = (target: Element, key: "ArrowDown" | "ArrowUp") =>
	target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

describe("openOverlay", () => {
	it("AC-CAL-12.1: opens next to its trigger, positioned by placeOverlay", () => {
		openOverlay(trigger, overlay);

		expect(overlay.isConnected).toBe(true);
		expect(overlay.classList.contains("calendaric-overlay")).toBe(true);
		expect([overlay.style.left, overlay.style.top]).toEqual(["100px", "120px"]);
	});

	it("AC-CAL-12.2: re-anchors to the trigger when a container it sits in scrolls", () => {
		openOverlay(trigger, overlay);

		stubRect(trigger, { left: 300, top: 250, width: 40, height: 20 });
		// `scroll` does not bubble; only a capturing listener sees an inner container scroll.
		scroller.dispatchEvent(new Event("scroll"));

		expect(overlay.isConnected).toBe(true);
		expect([overlay.style.left, overlay.style.top]).toEqual(["300px", "270px"]);
	});

	it("AC-CAL-12.2: re-anchors to the trigger when the window resizes", () => {
		openOverlay(trigger, overlay);

		stubRect(trigger, { left: 50, top: 60, width: 40, height: 20 });
		window.dispatchEvent(new Event("resize"));

		expect([overlay.style.left, overlay.style.top]).toEqual(["50px", "80px"]);
	});

	it("AC-CAL-12.2: closes when the trigger scrolls out of the window", () => {
		const onClose = vi.fn();
		openOverlay(trigger, overlay, { onClose });

		stubRect(trigger, { left: 100, top: -60, width: 40, height: 20 });
		scroller.dispatchEvent(new Event("scroll"));

		expect(overlay.isConnected).toBe(false);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("AC-CAL-12.3: arrow keys move focus between the items and the list stays open", () => {
		const items = ["a", "b", "c"].map((text) => {
			const item = overlay.appendChild(document.createElement("div"));
			item.className = "item";
			item.textContent = text;
			return item;
		});
		openOverlay(trigger, overlay, { itemSelector: ".item" });

		// The first press can come from the trigger, e.g. a text input the list suggests for.
		arrow(trigger, "ArrowDown");
		expect(document.activeElement).toBe(items[0]);
		arrow(items[0]!, "ArrowDown");
		expect(document.activeElement).toBe(items[1]);
		arrow(items[1]!, "ArrowDown");
		arrow(items[2]!, "ArrowDown");
		expect(document.activeElement).toBe(items[0]);
		arrow(items[0]!, "ArrowUp");
		expect(document.activeElement).toBe(items[2]);
		arrow(items[2]!, "ArrowUp");
		expect(document.activeElement).toBe(items[1]);

		expect(overlay.isConnected).toBe(true);
	});

	it("AC-CAL-12.3: an overlay that is not a list leaves arrow keys alone", () => {
		const item = overlay.appendChild(document.createElement("div"));
		item.className = "item";
		openOverlay(trigger, overlay);

		expect(arrow(trigger, "ArrowDown")).toBe(true);
		expect(document.activeElement).not.toBe(item);
	});

	it("AC-CAL-12.4: a click or tap outside the overlay closes it", () => {
		const onClose = vi.fn();
		openOverlay(trigger, overlay, { onClose });

		pointerDown(outside);

		expect(overlay.isConnected).toBe(false);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("AC-CAL-12.4: a click or tap inside the overlay leaves it open", () => {
		const item = overlay.appendChild(document.createElement("div"));
		openOverlay(trigger, overlay);

		pointerDown(item);

		expect(overlay.isConnected).toBe(true);
	});

	it("AC-CAL-12.5: closes when its trigger is removed from the page", async () => {
		const onClose = vi.fn();
		openOverlay(trigger, overlay, { onClose });

		// What a grid re-render does to the old cells.
		scroller.replaceChildren(document.createElement("div"));
		await tick();

		expect(overlay.isConnected).toBe(false);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("AC-CAL-12.5: an unrelated change to the page leaves it open", async () => {
		openOverlay(trigger, overlay);

		outside.appendChild(document.createElement("span"));
		await tick();

		expect(overlay.isConnected).toBe(true);
	});

	it("removes on close exactly the listeners it added, with the same capture flag", () => {
		// happy-dom defines these per class, so spy on each target the controller could touch.
		const targets: EventTarget[] = [window, document, trigger, overlay];
		const calls = (method: "addEventListener" | "removeEventListener") =>
			targets.map((target) => ({ target, spy: vi.spyOn(target, method) }));
		const adds = calls("addEventListener");
		const removes = calls("removeEventListener");
		// A listener is only removed by a call naming the same target, type, function and capture flag.
		const keys = (spies: ReturnType<typeof calls>) =>
			spies.flatMap(({ target, spy }) =>
				spy.mock.calls.map(([type, listener, opts]) => ({
					target,
					type,
					listener,
					capture: typeof opts === "boolean" ? opts : Boolean(opts?.capture),
				})),
			);

		const handle = openOverlay(trigger, overlay, { itemSelector: ".item" });
		const added = keys(adds);
		handle.close();

		expect(added.length).toBeGreaterThan(0);
		expect(keys(removes)).toEqual(expect.arrayContaining(added));
		expect(keys(removes)).toHaveLength(added.length);
	});

	it("removes every listener and the observer on close, so nothing fires afterwards", async () => {
		const disconnect = vi.spyOn(window.MutationObserver.prototype, "disconnect");
		const onClose = vi.fn();
		const items = [overlay.appendChild(document.createElement("div"))];
		items[0]!.className = "item";
		const handle = openOverlay(trigger, overlay, { onClose, itemSelector: ".item" });

		handle.close();
		handle.close();
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(disconnect).toHaveBeenCalled();

		// Put it back on the page, then send everything that would have reached it while open.
		document.body.appendChild(overlay);
		stubRect(trigger, { left: 300, top: 250, width: 40, height: 20 });
		scroller.dispatchEvent(new Event("scroll"));
		window.dispatchEvent(new Event("resize"));
		pointerDown(outside);
		expect(arrow(trigger, "ArrowDown")).toBe(true);
		expect(arrow(items[0]!, "ArrowDown")).toBe(true);
		trigger.remove();
		await tick();

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(overlay.isConnected).toBe(true);
		expect([overlay.style.left, overlay.style.top]).toEqual(["100px", "120px"]);
		expect(document.activeElement).not.toBe(items[0]);
	});
});
