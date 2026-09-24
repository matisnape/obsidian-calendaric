/* eslint-disable import/no-nodejs-modules -- a test reading the repository's
   own source; esbuild never bundles it. */
import { readdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
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

/**
 * Source with comments removed, so prose that names a surface never counts as
 * code. The ranges come from the TypeScript parser, so a `/*` or `//` inside a
 * string or a regex literal stays code.
 */
const stripComments = (text: string): string => {
	const file = ts.createSourceFile("source.ts", text, ts.ScriptTarget.Latest, true);
	const comments = new Map<number, number>();
	const visit = (node: ts.Node): void => {
		const around = [
			...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
			...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? []),
		];
		for (const range of around) comments.set(range.pos, range.end);
		node.getChildren(file).forEach(visit);
	};
	visit(file);

	let kept = "";
	let at = 0;
	for (const [pos, end] of [...comments].sort(([a], [b]) => a - b)) {
		kept += text.slice(at, pos);
		at = end;
	}
	return kept + text.slice(at);
};

const stripped = new Map<string, string>();
const code = (path: string): string => {
	const known = stripped.get(path);
	if (known !== undefined) return known;
	const text = stripComments(readFileSync(root(path), "utf8"));
	stripped.set(path, text);
	return text;
};

const SHIPPED = readdirSync(root("src"), { recursive: true, encoding: "utf8" })
	.map((entry) => `src/${entry.split(sep).join("/")}`)
	.filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.includes("/__mocks__/"))
	.sort();

const occurrences = (pattern: RegExp): string[] =>
	SHIPPED.flatMap((path) => [...code(path).matchAll(pattern)].map((m) => `${path}: ${m[0]}`));

const NAME = `["'](?:day|week|month|quarter|year)["']`;

/**
 * Two or more granularity names in a row, joined by `|` or `,`: the set, or part
 * of it, spelled out as a union or an array. A subset handed to `Extract` or
 * `Exclude` narrows the one declaration instead of restating it, so it is not one.
 */
const SPELLED_OUT = new RegExp(`((?:Extract|Exclude)<\\s*\\w+\\s*,\\s*)?(?:${NAME}\\s*[|,]\\s*)+${NAME}`, "g");

const spelledOut = (source: string): string[] =>
	[...source.matchAll(SPELLED_OUT)].filter((m) => m[1] === undefined).map((m) => m[0]);

describe("AC-ARCH-02.1: one module declares the granularity set", () => {
	// settings.ts loops over the two granularities it migrates. That is logic, not a
	// declaration of the set, and stays out of this ticket's scope.
	it("AC-ARCH-02.1: src/types.ts is the only module spelling the set out as literals", () => {
		const spelled = SHIPPED.flatMap((path) => spelledOut(code(path)).map((names) => `${path}: ${names}`));

		expect(spelled).toEqual([
			'src/settings.ts: "day", "week"',
			'src/types.ts: "day", "week", "month", "quarter", "year"',
			'src/types.ts: "day", "week", "month", "year"',
		]);
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
	it("AC-ARCH-02.5: the spelling check tells a restated set from a derived subset", () => {
		expect(spelledOut('type ActiveGranularity = "day" | "week";')).toEqual(['"day" | "week"']);
		expect(spelledOut("type G =\n\t| 'day'\n\t| 'month';")).toEqual(["'day'\n\t| 'month'"]);
		expect(spelledOut('granularity: "day" | "week" | "month",')).toEqual(['"day" | "week" | "month"']);
		expect(spelledOut('const G = ["day", "week", "month"];')).toEqual(['"day", "week", "month"']);
		expect(spelledOut('type A = Extract<Granularity, "day" | "week">;')).toEqual([]);
		expect(spelledOut('type Kind = "day" | "night";')).toEqual([]);
	});

	it("AC-ARCH-02.5: comment stripping leaves strings and regex literals intact", () => {
		const source = 'const glob = "notes/*.md";\nconst url = "a://b";\nconst re = /\\/*x/;\n// gone\n/* gone */ const kept = "*/";';

		expect(stripComments(source)).toBe('const glob = "notes/*.md";\nconst url = "a://b";\nconst re = /\\/*x/;\n\n const kept = "*/";');
	});
});

/** `moment(input, format…)`, the `utc` and `parseZone` spellings included. */
const MOMENT_PARSE = /\bmoment(?:\.(?:utc|parseZone))?\((?:[^(),]|\([^()]*\))+,/g;

/** `{{date`, `{{time`, … with the braces escaped any number of times, as a regex or a string spells them. */
const TEMPLATE_TOKEN = /(?:\\*\{){2}\s*(?:date|time|title|yesterday|tomorrow)\b/g;

describe("AC-ARCH-02.5: the parser and token checks recognise the shapes they exist to catch", () => {
	const hits = (pattern: RegExp, source: string): number => [...source.matchAll(pattern)].length;

	it("AC-ARCH-02.5: the parser check sees plain, utc and parseZone parses, not other moment calls", () => {
		expect(hits(MOMENT_PARSE, 'window.moment(name, "YYYY-MM-DD", true)')).toBe(1);
		expect(hits(MOMENT_PARSE, "window.moment.utc(name, fmt, true)")).toBe(1);
		expect(hits(MOMENT_PARSE, "moment.parseZone(`${a}`, fmt)")).toBe(1);
		expect(hits(MOMENT_PARSE, "moment.updateLocale(locale, { week })")).toBe(0);
		expect(hits(MOMENT_PARSE, "window.moment(Number(x.split(\":\")[1]))")).toBe(0);
	});

	it("AC-ARCH-02.5: the token check sees a token however its braces are escaped", () => {
		expect(hits(TEMPLATE_TOKEN, "out.replace(/{{date}}/g, d)")).toBe(1);
		expect(hits(TEMPLATE_TOKEN, "out.replace(/\\{\\{title\\}\\}/g, t)")).toBe(1);
		expect(hits(TEMPLATE_TOKEN, 'new RegExp("\\\\{\\\\{date")')).toBe(1);
		expect(hits(TEMPLATE_TOKEN, 'out.split("{{time}}")')).toBe(1);
		expect(hits(TEMPLATE_TOKEN, 'const css = "{{ width }}"')).toBe(0);
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
		const parsers = occurrences(MOMENT_PARSE).map((hit) => hit.split(":")[0]);

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
		expect([...new Set(occurrences(TEMPLATE_TOKEN).map((hit) => hit.split(":")[0]))]).toEqual([
			"src/notes/templateTokens.ts",
		]);
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

	// A second probe naming the production ids needs a registry read, which the
	// checks above catch, or a call to findCommunityPlugin, which this one does.
	it("AC-ARCH-02.4: every community probe passes its adapter's one id list", () => {
		const probes = occurrences(/(?<!function\s+)\bfindCommunityPlugin\(\s*[^,]+,\s*[^,]+,/g).map((hit) =>
			hit.replace(/findCommunityPlugin\(\s*[^,]+,\s*([^,]+),/, "$1"),
		);

		expect(probes).toEqual([
			"src/adapters/obsidianCalendarPluginAdapter.ts: CALENDAR_IDS",
			"src/adapters/obsidianCalendarPluginAdapter.ts: CALENDAR_IDS",
			"src/adapters/obsidianPeriodicNotesAdapter.ts: PERIODIC_NOTES_IDS",
		]);
	});
});
