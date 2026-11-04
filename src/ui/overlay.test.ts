import { describe, it, expect } from "vitest";
import { placeOverlay } from "./overlay";

const viewport = { width: 800, height: 600 };
const size = { width: 200, height: 100 };
const trigger = (left: number, top: number, width = 40, height = 20) => ({
	left,
	top,
	right: left + width,
	bottom: top + height,
});

const fitsInside = (pos: { left: number; top: number }, overlay = size) =>
	pos.left >= 0 &&
	pos.top >= 0 &&
	pos.left + overlay.width <= viewport.width &&
	pos.top + overlay.height <= viewport.height;

describe("placeOverlay", () => {
	it("AC-CAL-12.1: away from every edge it opens just below the trigger, aligned to its left side", () => {
		expect(placeOverlay(trigger(100, 100), size, viewport)).toEqual({ left: 100, top: 120 });
	});

	it("AC-CAL-12.1: near the right edge it shifts left so its right side stays inside the window", () => {
		const pos = placeOverlay(trigger(700, 100), size, viewport);

		expect(pos).toEqual({ left: 600, top: 120 });
		expect(fitsInside(pos)).toBe(true);
	});

	it("AC-CAL-12.1: a trigger partly past the left edge still gets an overlay that starts inside the window", () => {
		const pos = placeOverlay(trigger(-30, 100), size, viewport);

		expect(pos).toEqual({ left: 0, top: 120 });
		expect(fitsInside(pos)).toBe(true);
	});

	it("AC-CAL-12.1: near the bottom edge it flips above the trigger", () => {
		const pos = placeOverlay(trigger(100, 550), size, viewport);

		expect(pos).toEqual({ left: 100, top: 450 });
		expect(fitsInside(pos)).toBe(true);
	});

	it("AC-CAL-12.1: it flips above when the space there is exactly its height", () => {
		const short = { width: 800, height: 200 };

		expect(placeOverlay(trigger(100, 100), size, short)).toEqual({ left: 100, top: 0 });
	});

	it("AC-CAL-12.1: with no room above or below it is clamped to the bottom edge", () => {
		const tall = { width: 200, height: 560 };
		const pos = placeOverlay(trigger(100, 50), tall, viewport);

		expect(pos).toEqual({ left: 100, top: 40 });
		expect(fitsInside(pos, tall)).toBe(true);
	});

	it("AC-CAL-12.1: a trigger scrolled partly past the top edge still gets an overlay that starts inside the window", () => {
		const pos = placeOverlay(trigger(100, -40), size, viewport);

		expect(pos).toEqual({ left: 100, top: 0 });
		expect(fitsInside(pos)).toBe(true);
	});

	it("AC-CAL-12.1: in the bottom-right corner it shifts left and flips above at once", () => {
		const pos = placeOverlay(trigger(750, 560), size, viewport);

		expect(pos).toEqual({ left: 600, top: 460 });
		expect(fitsInside(pos)).toBe(true);
	});

	it("AC-CAL-12.1: an overlay larger than the window keeps its top-left corner visible", () => {
		expect(placeOverlay(trigger(100, 100), { width: 900, height: 700 }, viewport)).toEqual({ left: 0, top: 0 });
	});
});
