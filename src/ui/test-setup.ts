import moment from "moment";
import { installObsidianDom } from "../__mocks__/obsidianDom";

// Obsidian hangs moment off the window; production code never imports it.
const obsidianMoment = Object.assign(
	(...args: Parameters<typeof moment>) => moment(...args),
	moment
);

const globals = globalThis as unknown as { window?: Record<string, unknown> };

if (globals.window === undefined) {
	// Node environment (the default, and what all but the rendering tests use):
	// window.moment is the only thing the code under test reads.
	globals.window = { moment: obsidianMoment };
} else {
	// DOM environment, opted into per file with `// @vitest-environment happy-dom`.
	// Keep the real window and add moment to it, then install the DOM extensions
	// Obsidian patches onto Node and Element at runtime.
	globals.window["moment"] = obsidianMoment;
	installObsidianDom();
}
