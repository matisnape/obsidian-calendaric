import { describe, it, expect, vi, beforeEach } from "vitest";
import { createNote } from "./noteCreate";
import { substituteTemplateTokens } from "./templateTokens";
import { PeriodicNoteIndex } from "./periodicNoteIndex";
import type { PeriodicConfigs } from "./periodicNoteIndex";
import { openNoteIn } from "./noteOpen";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "../adapters/fakeVaultConfigPort";
import { FakeWorkspacePort } from "../adapters/fakeWorkspacePort";
import { DEFAULT_PERIODIC_CONFIG } from "../types";
import type { PeriodicConfig } from "../types";

/**
 * Every substitution pass, counted, wherever it is called from.
 *
 * The whole story is a negative — the plugin expands a template once and never
 * again — so the call count IS the assertion. `importOriginal` keeps the real
 * expansion, because a stub would let a test pass on content nobody produced.
 */
vi.mock("./templateTokens", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./templateTokens")>();
	return { ...actual, substituteTemplateTokens: vi.fn(actual.substituteTemplateTokens) };
});

const passes = vi.mocked(substituteTemplateTokens);

// The clock hangs off the window here as it does inside Obsidian; `moment` is
// never imported directly (the no-restricted-imports rule, and DEC on the clock).
const DATE = window.moment("2026-04-13T14:30:00");

const TEMPLATE_PATH = "Templates/daily.md";
const NOTE_PATH = "Daily/2026-04-13.md";

/** A template that exercises three token families and no wall-clock token. */
const TEMPLATE_BODY = "# {{title}}\n\n{{date}} follows {{yesterday}} and leads to {{date+1d}}.\n";
const SUBSTITUTED = "# 2026-04-13\n\n2026-04-13 follows 2026-04-12 and leads to 2026-04-14.\n";

function dailyConfig(overrides: Partial<PeriodicConfig> = {}): PeriodicConfig {
	return {
		...DEFAULT_PERIODIC_CONFIG,
		enabled: true,
		format: "YYYY-MM-DD",
		folder: "Daily",
		templatePath: TEMPLATE_PATH,
		...overrides,
	};
}

const CONFIGS: PeriodicConfigs = { day: dailyConfig() };
const NO_DEFAULT_FOLDER = new FakeVaultConfigPort("");

/** For the cases that are not about warnings: `warn` is required, so every call names one. */
const noWarn = () => undefined;

function vaultWithTemplate(body: string): FakeVaultPort {
	const vault = new FakeVaultPort();
	vault.seedFolder("Templates");
	vault.seedFile(TEMPLATE_PATH, body);
	return vault;
}

beforeEach(() => {
	passes.mockClear();
});

describe("US-TPL-05 — a template is applied once, at creation", () => {
	it("AC-TPL-05.1: substitutes once, writes once, and that write is the note's final content", async () => {
		const vault = vaultWithTemplate(TEMPLATE_BODY);
		const writes = vi.spyOn(vault, "createFile");

		await createNote(NOTE_PATH, DATE, "day", dailyConfig(), vault, noWarn);

		expect(passes).toHaveBeenCalledTimes(1);
		expect(writes).toHaveBeenCalledTimes(1);

		// The one write's own argument, compared against what the vault now holds:
		// a second pass would have to land through some other write to hide here.
		const written = writes.mock.calls[0]?.[1];
		expect(written).toBe(SUBSTITUTED);
		expect(vault.contentAt(NOTE_PATH)).toBe(SUBSTITUTED);
	});

	it("AC-TPL-05.1: leaves the written body alone once the create has settled", async () => {
		const vault = vaultWithTemplate(TEMPLATE_BODY);

		await createNote(NOTE_PATH, DATE, "day", dailyConfig(), vault, noWarn);
		// Anything deferred to a later microtask would land by now.
		await Promise.resolve();

		expect(vault.contentAt(NOTE_PATH)).toBe(SUBSTITUTED);
		expect(passes).toHaveBeenCalledTimes(1);
	});

	it("AC-TPL-05.4: with no external engine at all, the note is exactly the token-substituted content", async () => {
		// Nothing but the vault is handed to `createNote`: there is no engine port
		// to install, so "no engine configured" is the only shape this call has.
		const vault = vaultWithTemplate(TEMPLATE_BODY);
		const warn = vi.fn();

		const file = await createNote(NOTE_PATH, DATE, "day", dailyConfig(), vault, warn);

		expect(file.path).toBe(NOTE_PATH);
		expect(vault.contentAt(NOTE_PATH)).toBe(SUBSTITUTED);
		expect(passes.mock.results[0]?.value).toBe(SUBSTITUTED);
		// Nothing further is expected of the plugin: no warning, no fold pass.
		expect(warn).not.toHaveBeenCalled();
		expect(vault.appliedFoldStates).toEqual([]);
	});
});

describe("US-TPL-05 — a template that produces nothing is not an error", () => {
	it("AC-TPL-05.3: an empty template leaves an empty note, with no warning and no retry", async () => {
		const vault = vaultWithTemplate("");
		const writes = vi.spyOn(vault, "createFile");
		const warn = vi.fn();

		const file = await createNote(NOTE_PATH, DATE, "day", dailyConfig(), vault, warn);

		expect(file.path).toBe(NOTE_PATH);
		expect(vault.contentAt(NOTE_PATH)).toBe("");
		expect(warn).not.toHaveBeenCalled();
		expect(passes).toHaveBeenCalledTimes(1);
		expect(writes).toHaveBeenCalledTimes(1);
	});

	it("AC-TPL-05.3: a template that carries no tokens is written through unchanged", async () => {
		const unchanged = "Nothing to expand here.\n";
		const vault = vaultWithTemplate(unchanged);
		const warn = vi.fn();

		await createNote(NOTE_PATH, DATE, "day", dailyConfig(), vault, warn);

		expect(vault.contentAt(NOTE_PATH)).toBe(unchanged);
		expect(warn).not.toHaveBeenCalled();
		expect(passes).toHaveBeenCalledTimes(1);
	});
});

describe("US-TPL-05 — a companion plugin moves the note after creation", () => {
	const MOVED_PATH = "Daily/2026/04/2026-04-13.md";

	/**
	 * Create the note, then have another plugin move it and the host report the
	 * move — which is exactly how Obsidian surfaces a rename made by anyone,
	 * this plugin included (`obsidianVaultAdapter.ts:59-62`, AC-NOTE-11.3).
	 */
	async function createThenMove() {
		const vault = vaultWithTemplate(TEMPLATE_BODY);
		await createNote(NOTE_PATH, DATE, "day", dailyConfig(), vault, noWarn);
		const index = new PeriodicNoteIndex(vault, NO_DEFAULT_FOLDER, CONFIGS);

		passes.mockClear();
		const writes = vi.spyOn(vault, "createFile");

		vault.renameFile(NOTE_PATH, MOVED_PATH);
		vault.emitChange({ kind: "rename", file: { path: MOVED_PATH }, oldPath: NOTE_PATH });

		return { vault, index, writes };
	}

	it("AC-TPL-05.2: the calendar refresh finds the note at its current name and location", async () => {
		const { index } = await createThenMove();

		expect(index.get("day", DATE)?.path).toBe(MOVED_PATH);
		expect(index.paths()).toEqual([MOVED_PATH]);
	});

	it("AC-TPL-05.2: the move is never reverted and the body is never re-substituted", async () => {
		const { vault, writes } = await createThenMove();

		expect(vault.contentAt(MOVED_PATH)).toBe(SUBSTITUTED);
		expect(vault.contentAt(NOTE_PATH)).toBeUndefined();
		expect(passes).not.toHaveBeenCalled();
		expect(writes).not.toHaveBeenCalled();
	});

	it("AC-TPL-05.2: opening the note again opens the moved file, without touching the template", async () => {
		const { index, vault } = await createThenMove();
		const workspace = new FakeWorkspacePort();

		const file = index.get("day", DATE);
		expect(file).not.toBeNull();
		await openNoteIn(file as { path: string }, "reuse", workspace, MOVED_PATH);

		expect(workspace.foundPaths).toEqual([MOVED_PATH]);
		expect(workspace.opened.map((open) => open.file.path)).toEqual([MOVED_PATH]);
		expect(workspace.notices).toEqual([]);
		expect(passes).not.toHaveBeenCalled();
		expect(vault.contentAt(MOVED_PATH)).toBe(SUBSTITUTED);
	});
});
