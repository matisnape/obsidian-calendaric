import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, it, expect, expectTypeOf } from "vitest";
import { GRANULARITY_REGISTRY } from "./granularity/registry";
import { ALL_GRANULARITIES, RELEASE_GRANULARITIES, isReleaseGranularity } from "./types";
import type { CellGranularity, Granularity, ReleaseGranularity } from "./types";
import { GRANULARITIES, defaultGranularityConfigs, defaultStoredConfig, loadStoredConfig } from "./settings/model";

// US-ARCH-05: adding a granularity is one registry entry plus that granularity's
// own module. That stays true only while no other module knows the names, so
// the scan below fails the moment one of them is compared, switched on or
// listed outside src/granularity/.

const root = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path: string): string => readFileSync(root(path), "utf8");

const SCANNED = readdirSync(root("src"), { recursive: true, encoding: "utf8" })
	.map((entry) => `src/${entry.split(sep).join("/")}`)
	.filter((path) => path.endsWith(".ts"))
	.filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".typetest.ts"))
	.filter((path) => !path.includes("/__mocks__/"))
	.filter((path) => path !== "src/ui/test-setup.ts")
	.sort();

const OWNER = "src/granularity/";

const NAMES: ReadonlySet<string> = new Set(["day", "week", "month", "quarter", "year"]);

const isName = (node: ts.Node | undefined): boolean =>
	node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && NAMES.has(node.text);

const keyName = (name: ts.PropertyName | undefined): string | undefined =>
	name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined;

/** The names a type literal or a union of them carries, as their literal type nodes. */
const nameLiterals = (type: ts.TypeNode): ts.TypeNode[] =>
	(ts.isUnionTypeNode(type) ? type.types : [type]).filter((member) => ts.isLiteralTypeNode(member) && isName(member.literal));

const namedKeys = (members: readonly (ts.ObjectLiteralElementLike | ts.TypeElement)[]): number =>
	new Set(members.map((member) => keyName(member.name)).filter((key) => key !== undefined && NAMES.has(key))).size;

/**
 * Every place `source` knows a granularity by name: a comparison with one, a
 * `case` for one, a membership test (`in`, `includes`, `has`), a filter type
 * (`Extract`, `Exclude`, `Omit` or `Pick`) naming one, or a hand-written list of two or more
 * (an array, a union type, or an object or type literal keyed by them). A
 * moment unit argument such as `startOf("month")` is none of these, and
 * neither is a one-key object such as the duration `{ day: 1 }`.
 */
export function granularityKnowledge(source: string): string[] {
	const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
	const found: string[] = [];
	const report = (node: ts.Node): void => {
		found.push(node.getText(file).replace(/\s+/g, " "));
	};
	const COMPARE = new Set([
		ts.SyntaxKind.EqualsEqualsEqualsToken,
		ts.SyntaxKind.ExclamationEqualsEqualsToken,
		ts.SyntaxKind.EqualsEqualsToken,
		ts.SyntaxKind.ExclamationEqualsToken,
	]);
	const MEMBERSHIP = new Set(["includes", "has"]);
	const FILTER_TYPES = new Set(["Extract", "Exclude", "Omit", "Pick"]);
	const visit = (node: ts.Node): void => {
		if (ts.isBinaryExpression(node) && COMPARE.has(node.operatorToken.kind) && (isName(node.left) || isName(node.right))) {
			report(node);
		} else if (ts.isCaseClause(node) && isName(node.expression)) {
			report(node.expression);
		} else if (ts.isArrayLiteralExpression(node) && node.elements.filter(isName).length >= 2) {
			report(node);
		} else if (ts.isUnionTypeNode(node) && nameLiterals(node).length >= 2) {
			report(node);
		} else if (ts.isObjectLiteralExpression(node) && namedKeys(node.properties) >= 2) {
			report(node);
		} else if (ts.isTypeLiteralNode(node) && namedKeys(node.members) >= 2) {
			report(node);
		} else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword && isName(node.left)) {
			report(node);
		} else if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			MEMBERSHIP.has(node.expression.name.text) &&
			isName(node.arguments[0])
		) {
			report(node.arguments[0] as ts.Node);
		} else if (ts.isTypeReferenceNode(node) && FILTER_TYPES.has(node.typeName.getText(file))) {
			for (const type of node.typeArguments ?? []) {
				const names = nameLiterals(type);
				// A union of two or more names is already reported whole, by the union rule.
				if (names.length === 1) report(names[0] as ts.Node);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

/**
 * Knowledge that is not about a Calendaric granularity, each with why. An entry
 * is the exact finding and how often it occurs, never a whole file, so a new
 * comparison added beside one of these still fails, even a copy of it.
 */
const NOT_GRANULARITY_KNOWLEDGE: Record<string, { count: number; reason: string }> = {
	// parseFilename's token kinds name the date part a moment token reads.
	'src/fmt/parseFilename.ts: | "year" | "isoWeekYear" | "localeWeekYear" | "monthNum" | "monthName" | "monthNameShort" | "day" | "isoWeek" | "localeWeek" | "weekdayFull" | "weekdayShort" | "weekdayMin" | "weekdayNum"':
		{ count: 1, reason: "a moment token kind (the date part a token reads), not a granularity" },
	'src/fmt/parseFilename.ts: kind === "day"': { count: 1, reason: "a moment token kind, not a granularity" },
	'src/fmt/parseFilename.ts: "year"': { count: 1, reason: "a moment token kind in switch (kind), not a granularity" },
	'src/fmt/parseFilename.ts: "day"': { count: 1, reason: "a moment token kind in switch (kind), not a granularity" },
	// noteUtils sits below the registry: the week module imports it, so
	// reading the registry here would close the cycle the AC-ARCH-05.4 test forbids.
	'src/notes/noteUtils.ts: granularity === "week"':
		{ count: 1, reason: "weekday spans stay literal outside a weekly format; reading the registry here would make an import cycle" },
	// The core Daily Notes plugin and the Calendar plugin each configure one fixed period.
	'src/settings/importSource.ts: granularity === "day"': { count: 1, reason: "the core Daily Notes plugin configures the day and nothing else" },
	'src/settings/importSource.ts: granularity !== "day"': { count: 1, reason: "the core Daily Notes plugin configures the day and nothing else" },
	'src/notes/predecessorGuard.ts: granularity !== "day"': { count: 1, reason: "the core Daily Notes plugin owns the day and nothing else" },
	'src/notes/predecessorGuard.ts: granularity !== "week"': { count: 1, reason: "the Calendar plugin's weekly notes own the week and nothing else" },
};

const OTHER_BRANCH_FILES: ReadonlySet<string> = new Set([
	"src/settings/dailyNotesImportCard.ts",
	"src/settings/dailyNotesImportModal.ts",
	"src/settings/disableDailyNotesModal.ts",
]);

const findings = (): string[] =>
	SCANNED.filter((path) => !path.startsWith(OWNER) && !OTHER_BRANCH_FILES.has(path)).flatMap((path) =>
		granularityKnowledge(read(path)).map((text) => `${path}: ${text}`),
	);

describe("AC-ARCH-05.1: a granularity is known by name only in its registry entry and its own module", () => {
	it("AC-ARCH-05.1: no module outside src/granularity/ compares, switches on or lists a granularity name", () => {
		const outside = findings().filter((finding) => !(finding in NOT_GRANULARITY_KNOWLEDGE));

		expect(outside).toEqual([]);
	});

	it("AC-ARCH-05.1: every allowlisted finding occurs exactly as often as declared, so neither a copy nor a stale entry passes", () => {
		const tally: Record<string, number> = {};
		for (const finding of findings()) if (finding in NOT_GRANULARITY_KNOWLEDGE) tally[finding] = (tally[finding] ?? 0) + 1;
		const declared: Record<string, number> = {};
		for (const [finding, { count }] of Object.entries(NOT_GRANULARITY_KNOWLEDGE)) declared[finding] = count;

		expect(tally).toEqual(declared);
	});

	it("AC-ARCH-05.1: the scan reports each shape of granularity knowledge and nothing else", () => {
		expect(granularityKnowledge('if (granularity === "week") run();')).toEqual(['granularity === "week"']);
		expect(granularityKnowledge('if ("day" !== g) run();')).toEqual(['"day" !== g']);
		expect(granularityKnowledge('switch (g) { case "month": break; }')).toEqual(['"month"']);
		expect(granularityKnowledge('for (const g of ["day", "week"] as const) run(g);')).toEqual(['["day", "week"]']);
		expect(granularityKnowledge('type A = Extract<Granularity, "day" | "week">;')).toEqual(['"day" | "week"']);
		expect(granularityKnowledge('const L = { day: "daily", week: "weekly" };')).toEqual(['{ day: "daily", week: "weekly" }']);
		expect(granularityKnowledge("type T = { day: string; year: string };")).toEqual(["{ day: string; year: string }"]);
		expect(granularityKnowledge('type C = Exclude<ReleaseGranularity, "year">;')).toEqual(['"year"']);
		expect(granularityKnowledge('type C = Exclude<ReleaseGranularity, "year" | "night">;')).toEqual(['"year"']);
		expect(granularityKnowledge('type C = Omit<Configs, "week">;')).toEqual(['"week"']);
		expect(granularityKnowledge('type C = Pick<Configs, "day">;')).toEqual(['"day"']);
		expect(granularityKnowledge('if (ids.includes("week")) run();')).toEqual(['"week"']);
		expect(granularityKnowledge('if (seen.has("day")) run();')).toEqual(['"day"']);
		expect(granularityKnowledge('if ("week" in settings) run();')).toEqual(['"week" in settings']);
		expect(granularityKnowledge('date.startOf("month").add(1, "day");')).toEqual([]);
		expect(granularityKnowledge('const one = { day: 1 }; type K = "day" | "night";')).toEqual([]);
	});

	it("AC-ARCH-05.1: no granularity module imports another, so adding one edits none of the others", () => {
		const modules = SCANNED.filter((path) => path.startsWith(OWNER) && path !== `${OWNER}registry.ts`);
		const siblings = modules.flatMap((path) =>
			runtimeOrTypeImports(path)
				.filter((to) => modules.includes(to))
				.map((to) => `${path} -> ${to}`),
		);

		expect(modules.length).toBe(ALL_GRANULARITIES.length);
		expect(siblings).toEqual([]);
	});
});

describe("AC-ARCH-05.4: a new granularity's footprint is its module, its entry and its default", () => {
	it("AC-ARCH-05.4: the registry holds one entry per granularity module, in the order the UI uses", () => {
		const modules = SCANNED.filter((path) => path.startsWith(OWNER) && path !== `${OWNER}registry.ts`)
			.map((path) => posix.basename(path, ".ts"))
			.sort();

		expect(GRANULARITY_REGISTRY.map((entry) => entry.id).sort()).toEqual(modules);
		expect(ALL_GRANULARITIES).toEqual(["day", "week", "month", "quarter", "year"]);
	});

	it("AC-ARCH-05.4: the settings default for every granularity comes from its own entry", () => {
		const defaults = defaultGranularityConfigs();

		for (const entry of GRANULARITY_REGISTRY) expect(defaults[entry.id].enabled).toBe(entry.defaultEnabled);
		// Equal values alone pass a hand-written default; the source must not list the names either.
		expect(granularityKnowledge(read("src/settings/model.ts"))).toEqual([]);
	});

	// A cycle through the registry builds and tests fine, then hands the bundle an
	// undefined entry: esbuild hoists every module into one scope, and a module
	// that is still evaluating has not assigned its constants yet.
	it("AC-ARCH-05.4: nothing a granularity module imports at runtime reaches back to the registry", () => {
		const modules = SCANNED.filter((path) => path.startsWith(OWNER) && path !== `${OWNER}registry.ts`);
		const reached = new Set<string>();
		const walk = (path: string): void => {
			for (const to of runtimeImports(path)) {
				if (reached.has(to)) continue;
				reached.add(to);
				walk(to);
			}
		};
		modules.forEach(walk);

		expect([...reached].filter((path) => path === `${OWNER}registry.ts` || path === "src/types.ts")).toEqual([]);
	});
});

describe("US-ARCH-05: every shared granularity name still exports, with the same type", () => {
	it("US-ARCH-05: the derived lists keep their literal tuple types", () => {
		expectTypeOf(ALL_GRANULARITIES).toEqualTypeOf<readonly ["day", "week", "month", "quarter", "year"]>();
		expectTypeOf(RELEASE_GRANULARITIES).toEqualTypeOf<readonly ["day", "week", "month", "year"]>();
		expectTypeOf<Granularity>().toEqualTypeOf<"day" | "week" | "month" | "quarter" | "year">();
		expectTypeOf<ReleaseGranularity>().toEqualTypeOf<"day" | "week" | "month" | "year">();
		expectTypeOf<CellGranularity>().toEqualTypeOf<"day" | "week" | "month">();
		expectTypeOf(GRANULARITIES).toEqualTypeOf<readonly Granularity[]>();
		expect(RELEASE_GRANULARITIES).toEqual(["day", "week", "month", "year"]);
	});

	it("US-ARCH-05: quarter stays stored but inert", () => {
		expect(isReleaseGranularity("quarter")).toBe(false);
		const stored = defaultStoredConfig();
		const set = stored.calendarSets[0];
		if (set === undefined) throw new Error("no default set");
		set.quarter = { enabled: true, format: "YYYY-[Q]Q", folder: "Q" };

		expect(loadStoredConfig(JSON.parse(JSON.stringify(stored))).calendarSets[0]?.quarter).toMatchObject({
			enabled: true,
			format: "YYYY-[Q]Q",
			folder: "Q",
		});
	});
});

const resolve = (from: string, specifier: string): string | null => {
	if (!specifier.startsWith(".")) return null;
	const base = posix.join(dirname(from), specifier);
	for (const candidate of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(root(candidate))) return candidate;
	return null;
};

const importsOf = (path: string, typeImportsToo: boolean): string[] => {
	const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
	const edges: string[] = [];
	for (const statement of file.statements) {
		if (ts.isImportDeclaration(statement)) {
			const clause = statement.importClause;
			const typeOnly =
				clause?.isTypeOnly === true ||
				(clause !== undefined &&
					clause.name === undefined &&
					clause.namedBindings !== undefined &&
					ts.isNamedImports(clause.namedBindings) &&
					clause.namedBindings.elements.length > 0 &&
					clause.namedBindings.elements.every((element) => element.isTypeOnly));
			if (typeOnly && !typeImportsToo) continue;
			const to = resolve(path, (statement.moduleSpecifier as ts.StringLiteral).text);
			if (to !== null) edges.push(to);
		} else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
			if (statement.isTypeOnly && !typeImportsToo) continue;
			const to = resolve(path, (statement.moduleSpecifier as ts.StringLiteral).text);
			if (to !== null) edges.push(to);
		}
	}
	return edges;
};

const runtimeImports = (path: string): string[] => importsOf(path, false);
const runtimeOrTypeImports = (path: string): string[] => importsOf(path, true);
