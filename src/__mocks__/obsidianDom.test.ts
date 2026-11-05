// @vitest-environment happy-dom
//
// The shim's other methods delegate straight to a standard DOM call and
// are checked by the tests that render real view code. toggleClass branches,
// and AC-CAL-02.4 will read its answer to decide whether the "return to today"
// control is inactive, so it gets its own check: a shim that toggled the wrong
// way would report a green verdict for a criterion that is false.
import { describe, it, expect } from "vitest";

describe("the Obsidian DOM shim", () => {
	it("toggleClass adds the class on true and removes it on false", () => {
		const el = document.createElement("div");

		el.toggleClass("is-disabled", true);
		expect(el.classList.contains("is-disabled")).toBe(true);

		el.toggleClass("is-disabled", false);
		expect(el.classList.contains("is-disabled")).toBe(false);
	});

	it("toggle hides the element on false and shows it again on true", () => {
		const el = document.createElement("div");

		el.toggle(false);
		expect(el.style.display).toBe("none");

		el.toggle(true);
		expect(el.style.display).toBe("");
	});
});
