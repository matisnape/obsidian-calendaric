// Obsidian's DOM extensions, installed onto the prototypes a DOM environment
// already provides.
//
// Obsidian patches Node and Element at runtime, so view code calls
// `el.createDiv(...)` and `el.empty()` as if they were standard. happy-dom
// gives us the standard DOM and nothing more, so the plugin's own view code
// cannot render under test until these exist.
//
// The method set is every DOM extension called anywhere under `src/` outside
// tests, derived by grepping each name Obsidian declares on Node/Element
// against the tree -- not by reading the one file the first test happened to
// need. Scoping that grep to `src/ui/` is what made the first version of this
// shim too small: it has to serve the settings tab too, and the settings tab
// is where three of these eight live.
//
//   createEl      calendar.ts:71-165, modal.ts, settings.ts, dailyNotesImport*
//   createDiv     calendar.ts:67-170, modal.ts:31, settings.ts, dailyNotesImportCard
//   createSpan    settings.ts:162,310 and settings/dailyNotesImportModal.ts:35
//   empty         calendar.ts:65,118,129,270; CalendarView.ts:27; settings.ts:71,228
//   addClass      calendar.ts:153,178; CalendarView.ts:28
//   toggleClass   settings.ts:189 (and calendar.ts:141 once pull request #20 lands)
//   setAttr       settings.ts:211,212
//   appendText    settings.ts:213,229
//
// Only `toggleClass` is exercised by a test of its own, because only it
// branches: it adds the class on true and removes it on false, and AC-CAL-02.4
// will ask this shim whether the "return to today" control is inactive. A shim
// that got that backwards would hand a green verdict to a criterion that is
// false. The other seven delegate straight to a standard DOM call with no
// branch, so the tests that render real view code are their check.
//
// `detach()` (calendarCommand.ts:77, obsidianCalendarLeafAdapter.ts:51,77) is
// deliberately absent: those calls are on the app's CalendarLeafHandle port,
// not on a DOM element.
//
// `isShown()` (obsidianCalendarLeafAdapter.ts:13) is absent on purpose too.
// It reports whether any ancestor hides the element, which happy-dom does not
// model, so a shim would have to guess. obsidianCalendarLeafAdapter.test.ts:57
// already injects its own, and its comment names isShown as one of "the parts
// no headless environment provides". Injecting beats guessing here.
//
// Inside DomElementInfo, `cls`, `text` and `attr` are the three options the
// view code passes. `title`, `parent`, `prepend`, `value`, `type`,
// `placeholder` and `href` are each a one-line addition when a caller appears.

/**
 * The three DomElementInfo options the view code passes.
 *
 * Obsidian declares DomElementInfo as an ambient global, which eslint's
 * `no-undef` cannot see, so the options are restated here. Every field keeps
 * Obsidian's own type, which is what makes the prototype assignments below
 * type-check against the real declarations.
 */
interface ElementOptions {
	cls?: string | string[];
	text?: string | DocumentFragment;
	attr?: Record<string, string | number | boolean | null>;
}

function applyInfo(el: HTMLElement, o: ElementOptions | string | undefined): void {
	if (o === undefined) return;

	// Obsidian's shorthand: a bare string is the class.
	const info: ElementOptions = typeof o === "string" ? { cls: o } : o;

	if (info.cls !== undefined) {
		const classes = typeof info.cls === "string" ? info.cls.split(" ") : info.cls;
		for (const cls of classes) {
			if (cls !== "") el.classList.add(cls);
		}
	}

	if (info.text !== undefined) {
		if (typeof info.text === "string") {
			el.textContent = info.text;
		} else {
			el.appendChild(info.text);
		}
	}

	if (info.attr !== undefined) {
		for (const [name, value] of Object.entries(info.attr)) {
			// Obsidian drops an attribute set to null rather than writing "null".
			if (value === null) continue;
			el.setAttribute(name, String(value));
		}
	}
}

/**
 * Patches Node.prototype and Element.prototype the way Obsidian does.
 *
 * Call it only where a DOM environment exists. Running it under the default
 * node environment throws, because `Node` is not defined there.
 */
export function installObsidianDom(): void {
	Node.prototype.createEl = function <K extends keyof HTMLElementTagNameMap>(
		this: Node,
		tag: K,
		o?: ElementOptions | string,
		callback?: (el: HTMLElementTagNameMap[K]) => void,
	): HTMLElementTagNameMap[K] {
		// `document` is itself a Node and its own ownerDocument is null.
		const el = (this.ownerDocument ?? document).createElement(tag);
		applyInfo(el, o);
		this.appendChild(el);
		callback?.(el);
		return el;
	};

	Node.prototype.createDiv = function (
		this: Node,
		o?: ElementOptions | string,
		callback?: (el: HTMLDivElement) => void,
	): HTMLDivElement {
		return this.createEl("div", o, callback);
	};

	Node.prototype.createSpan = function (
		this: Node,
		o?: ElementOptions | string,
		callback?: (el: HTMLSpanElement) => void,
	): HTMLSpanElement {
		return this.createEl("span", o, callback);
	};

	Element.prototype.empty = function (this: Element): void {
		while (this.firstChild !== null) {
			this.removeChild(this.firstChild);
		}
	};

	Element.prototype.addClass = function (this: Element, ...classes: string[]): void {
		this.classList.add(...classes);
	};

	Element.prototype.toggleClass = function (
		this: Element,
		classes: string | string[],
		value: boolean,
	): void {
		for (const cls of typeof classes === "string" ? [classes] : classes) {
			this.classList.toggle(cls, value);
		}
	};

	Element.prototype.setAttr = function (
		this: Element,
		qualifiedName: string,
		value: string | number | boolean | null,
	): void {
		// Obsidian drops the attribute rather than writing the string "null".
		if (value === null) {
			this.removeAttribute(qualifiedName);
			return;
		}
		this.setAttribute(qualifiedName, String(value));
	};

	Element.prototype.appendText = function (this: Element, val: string): void {
		this.appendChild((this.ownerDocument ?? document).createTextNode(val));
	};
}
