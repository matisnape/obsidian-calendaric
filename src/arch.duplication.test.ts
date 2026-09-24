/* eslint-disable import/no-nodejs-modules -- a test reading the repository's
   own source; esbuild never bundles it. */
import { readdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, expectTypeOf, vi } from "vitest";
import { isReleaseGranularity, RELEASE_GRANULARITIES } from "./types";
import type { Granularity, PeriodicConfig, ReleaseGranularity } from "./types";
import { parseFilename } from "./fmt/parseFilename";
import { resolveFileDate } from "./fmt/resolveFileDate";
import { validateFormat } from "./fmt/validateFormat";
import { substituteTemplateTokens } from "./notes/templateTokens";
import { createNote } from "./notes/noteCreate";
import { FakeVaultPort } from "./adapters/fakeVaultPort";
import { FakeVaultConfigPort } from "./adapters/fakeVaultConfigPort";

// US-ARCH-02: each shared concept has one implementation. The source checks
// below are the AC-ARCH-02.5 duplication check: `npm test` runs them, so a
// second parser, token resolver, registry probe or granularity type fails the
// pull request. The spies prove the call sites that exist today route through
// the one implementation.

vi.mock("./fmt/parseFilename", async (original) => {
	const real = await original<typeof import("./fmt/parseFilename")>();
	return { ...real, parseFilename: vi.fn(real.parseFilename) };
});

vi.mock("./notes/templateTokens", async (original) => {
	const real = await original<typeof import("./notes/templateTokens")>();
	return { ...real, substituteTemplateTokens: vi.fn(real.substituteTemplateTokens) };
});

const root = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

/** Source with comments removed, so prose that names a surface never counts as code. */
const code = (path: string): string =>
	readFileSync(root(path), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:\\])\/\/.*$/gm, "$1");

const SHIPPED = readdirSync(root("src"), { recursive: true, encoding: "utf8" })
	.map((entry) => `src/${entry.split(sep).join("/")}`)
	.filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.includes("/__mocks__/"))
	.sort();

const occurrences = (pattern: RegExp): string[] =>
	SHIPPED.flatMap((path) => [...code(path).matchAll(pattern)].map((m) => `${path}: ${m[0]}`));

const GRANULARITY_NAMES = new Set(["day", "week", "month", "quarter", "year"]);

/** `type X = "day" | "week"` — an alias whose whole right-hand side is granularity names. */
const LITERAL_UNION_ALIAS = /\btype\s+(\w+)\s*=\s*((?:\|?\s*["'][^"']*["']\s*)+);/g;

const granularityAliases = (source: string): string[] =>
	[...source.matchAll(LITERAL_UNION_ALIAS)]
		.filter((m) => {
			const names = [...(m[2] ?? "").matchAll(/["']([^"']*)["']/g)].map((n) => n[1] ?? "");
			return names.length >= 2 && names.every((name) => GRANULARITY_NAMES.has(name));
		})
		.map((m) => m[1] ?? "");

describe("AC-ARCH-02.1: one module declares the granularity set", () => {
	it("AC-ARCH-02.1: src/types.ts is the only module spelling the set out as literals", () => {
		const declared = SHIPPED.flatMap((path) => granularityAliases(code(path)).map((name) => `${path}: ${name}`));

		expect(declared).toEqual(["src/types.ts: Granularity"]);
	});

	it("AC-ARCH-02.1: no other module declares a type under the canonical names", () => {
		const redeclared = occurrences(/\b(?:type|interface|enum)\s+(?:Release)?Granularity\b/g);

		expect(redeclared.sort()).toEqual(["src/types.ts: type Granularity", "src/types.ts: type ReleaseGranularity"]);
	});

	it("AC-ARCH-02.1: quarter is carried by the type and reserved out of the release set", () => {
		expectTypeOf<Exclude<Granularity, ReleaseGranularity>>().toEqualTypeOf<"quarter">();
		expect(RELEASE_GRANULARITIES).toEqual(["day", "week", "month", "year"]);
		expect(isReleaseGranularity("quarter")).toBe(false);
	});

	// The check is text over source, so it is only worth having while it still
	// recognises the shapes it exists to catch.
	it("AC-ARCH-02.5: the alias check tells a redeclaration from a derived subset", () => {
		expect(granularityAliases('type ActiveGranularity = "day" | "week";')).toEqual(["ActiveGranularity"]);
		expect(granularityAliases("type G =\n\t| 'day'\n\t| 'month';")).toEqual(["G"]);
		expect(granularityAliases('type A = Extract<Granularity, "day" | "week">;')).toEqual([]);
		expect(granularityAliases('type Kind = "day" | "night";')).toEqual([]);
	});
});

describe("AC-ARCH-02.2: one routine parses a filename into a date", () => {
	const config = (format: string, allowPrefixMatch: boolean): PeriodicConfig => ({
		enabled: true,
		format,
		folder: "",
		templatePath: "",
		allowPrefixMatch,
		openAtStartup: false,
	});

	it("AC-ARCH-02.2: strict and prefix matching, for two granularities and two call sites, all call parseFilename", () => {
		const parse = vi.mocked(parseFilename);
		parse.mockClear();

		resolveFileDate("2026-04-13.md", { day: config("YYYY-MM-DD", false) }, new FakeVaultConfigPort());
		resolveFileDate("2026-W16 review.md", { week: config("GGGG-[W]WW", true) }, new FakeVaultConfigPort());
		validateFormat("YYYY-MM", "month");

		const calls = parse.mock.calls.map(([, format, prefix, granularity]) => `${granularity} ${format} ${prefix}`);
		expect(calls).toEqual(expect.arrayContaining(["day YYYY-MM-DD false", "week GGGG-[W]WW true"]));
		expect(calls.some((call) => call.startsWith("month YYYY-MM"))).toBe(true);
	});

	// moment's own string parser is what a second filename parser would be built
	// on. The index parses a frontmatter value with it, which is not a filename.
	it("AC-ARCH-02.5: no other module parses a string against a moment format", () => {
		const parsers = occurrences(/\bmoment\((?:[^(),]|\([^()]*\))+,/g).map((hit) => hit.split(":")[0]);

		expect([...new Set(parsers)].sort()).toEqual(["src/fmt/parseFilename.ts", "src/notes/periodicNoteIndex.ts"]);
	});
});

describe("AC-ARCH-02.3: one function resolves template tokens", () => {
	it("AC-ARCH-02.3: every release granularity resolves its template through substituteTemplateTokens", async () => {
		const substitute = vi.mocked(substituteTemplateTokens);
		substitute.mockClear();

		for (const granularity of RELEASE_GRANULARITIES) {
			const vault = new FakeVaultPort();
			vault.seedFile("t.md", "{{date}}");
			const config: PeriodicConfig = {
				enabled: true,
				format: "YYYY-MM-DD",
				folder: "",
				templatePath: "t.md",
				allowPrefixMatch: false,
				openAtStartup: false,
			};
			await createNote(`${granularity}.md`, window.moment("2026-04-13"), granularity, config, vault, () => undefined);
		}

		expect(substitute.mock.calls.map((call) => call[2])).toEqual([...RELEASE_GRANULARITIES]);
	});

	it("AC-ARCH-02.5: no other module substitutes a date, time or title token", () => {
		const TOKEN = /\\\{\\\{(?:date|time|title|yesterday|tomorrow)\b|["'`]\{\{(?:date|time|title|yesterday|tomorrow)\b/g;

		expect([...new Set(occurrences(TOKEN).map((hit) => hit.split(":")[0]))]).toEqual(["src/notes/templateTokens.ts"]);
	});
});

describe("AC-ARCH-02.4: one function probes each plugin registry", () => {
	// Two registries, two probes: core plugins live in `internalPlugins`, community
	// plugins in `plugins`. Each is read at exactly one site, so every caller goes
	// through the function holding it.
	it("AC-ARCH-02.5: the community registry is read once, by findCommunityPlugin", () => {
		expect(occurrences(/\[\s*["']plugins["']\s*\]|\.plugins\b/g)).toEqual([
			'src/adapters/communityPluginRegistry.ts: ["plugins"]',
		]);
	});

	it("AC-ARCH-02.5: the core registry is read once, by the companion adapter", () => {
		expect(occurrences(/\[\s*["']internalPlugins["']\s*\]|\.internalPlugins\b/g)).toEqual([
			'src/adapters/obsidianCompanionPluginAdapter.ts: ["internalPlugins"]',
		]);
	});

	it("AC-ARCH-02.4: each companion plugin's id list, dev id included, is declared once", () => {
		expect(occurrences(/["'](?:periodic-notes-anks|calendar-anks)["']/g)).toEqual([
			'src/adapters/obsidianCalendarPluginAdapter.ts: "calendar-anks"',
			'src/adapters/obsidianPeriodicNotesAdapter.ts: "periodic-notes-anks"',
		]);
	});
});
