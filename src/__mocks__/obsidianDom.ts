// Obsidian's DOM extensions, installed onto the prototypes a DOM environment
// already provides.
//
// Obsidian patches Node and Element at runtime, so view code calls
// `el.createDiv(...)` and `el.empty()` as if they were standard. happy-dom
// gives us the standard DOM and nothing more, so the plugin's own view code
// cannot render under test until these exist.
//
// The method set is exactly what `src/ui/` calls today: createEl, createDiv
// (calendar.ts:67-169, modal.ts), empty (calendar.ts:65,118,129) and addClass
// (calendar.ts:153,178). A shim for a method nothing calls is untested code
// pretending to be a harness. Add the next method when the next test needs it.
//
// The same applies inside DomElementInfo: `cls`, `text` and `attr` are the
// three options the view code passes. `title`, `parent`, `prepend`, `value`,
// `type`, `placeholder` and `href` are each a one-line addition when a caller
// appears.

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

	Element.prototype.empty = function (this: Element): void {
		while (this.firstChild !== null) {
			this.removeChild(this.firstChild);
		}
	};

	Element.prototype.addClass = function (this: Element, ...classes: string[]): void {
		this.classList.add(...classes);
	};
}
