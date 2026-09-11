/* eslint-disable import/no-nodejs-modules -- That rule guards the BUNDLE: a
   plugin shipping node:fs breaks on Obsidian mobile and fails community review.
   This file is a test, esbuild never sees it, and reading the repository's own
   configuration is the whole point of it. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// Four acceptance criteria are about the SHAPE of the repository rather than
// about runtime behaviour: which module may import what, where `any` is
// allowed, what the type checker looks at, and what the build emits. They were
// settled by reading the files, and a verdict settled that way has nothing
// holding it in place -- the next refactor can undo it in silence.
//
// These assertions are that holding. Each one fails on the exact regression its
// criterion forbids, and on nothing else.

const root = (path: string): string =>
	fileURLToPath(new URL(`../${path}`, import.meta.url));

const read = (path: string): string => readFileSync(root(path), "utf8");

describe("AC-ARCH-03.4: pure logic does not reach for the Obsidian API", () => {
	// The port/adapter split is only worth its indirection while the inner
	// modules stay reachable without a running Obsidian. One import of the host
	// API here and the module can no longer be unit-tested at all.
	const pure = [
		"src/notes/templateTokens.ts",
		"src/notes/noteUtils.ts",
		"src/fmt/noteDate.ts",
	];

	for (const path of pure) {
		it(`${path} imports nothing from "obsidian"`, () => {
			const imports = read(path)
				.split("\n")
				.filter((line) => line.trimStart().startsWith("import"));

			expect(imports.join("\n")).not.toMatch(/["']obsidian["']/);
		});
	}
});

describe("AC-ARCH-04.2: the companion-plugin boundary is typed, not `any`", () => {
	// This boundary reads another plugin's settings object, which is the one
	// place in the codebase where `any` is tempting: the shape belongs to
	// someone else and is not guaranteed. Narrowing it deliberately is the
	// point of the port, so `any` here would give back exactly what it bought.
	const boundary = [
		"src/adapters/companionPluginPort.ts",
		"src/adapters/obsidianCompanionPluginAdapter.ts",
	];

	for (const path of boundary) {
		it(`${path} declares no value as \`any\``, () => {
			const source = read(path);

			expect(source).not.toMatch(/:\s*any\b/);
			expect(source).not.toMatch(/\bas\s+any\b/);
			expect(source).not.toMatch(/<any>/);
		});
	}
});

describe("AC-ARCH-04.5: the type checker reads the tests too", () => {
	// `npm test` and `npm run build` disagree once test files fall out of the
	// compiler's view: a test can index an array raw, pass vitest, and fail the
	// build under noUncheckedIndexedAccess. Three branches were bitten by that
	// in one week, which is why the exclude is gone and why this guards it.
	const tsconfig = JSON.parse(read("tsconfig.json")) as {
		include?: string[];
		exclude?: string[];
		compilerOptions?: Record<string, unknown>;
	};

	it("includes every .ts file under src, tests among them", () => {
		expect(tsconfig.include).toContain("src/**/*.ts");
	});

	it("excludes no test file from the type check", () => {
		const excluded = tsconfig.exclude ?? [];

		expect(excluded.filter((entry) => entry.includes("test"))).toEqual([]);
	});

	it("keeps the setting that makes raw indexing in a test fail the build", () => {
		expect(tsconfig.compilerOptions?.noUncheckedIndexedAccess).toBe(true);
	});

	// AC-ARCH-04.1: one `strict`, not a hand-picked subset of its parts.
	// TypeScript keeps adding sub-checks to the strict family, and a project
	// listing them individually silently opts out of every one added later.
	it("AC-ARCH-04.1: enables strict mode whole, never flag by flag", () => {
		const options = tsconfig.compilerOptions ?? {};
		const family = [
			"noImplicitAny",
			"noImplicitThis",
			"strictNullChecks",
			"strictFunctionTypes",
			"strictBindCallApply",
			"strictPropertyInitialization",
			"strictBuiltinIteratorReturn",
			"alwaysStrict",
			"useUnknownInCatchVariables",
		];

		expect(options.strict).toBe(true);
		expect(family.filter((flag) => flag in options)).toEqual([]);
	});
});

describe("AC-ARCH-09.1: the pull request gets one job and one status check", () => {
	// This account's GitHub Actions run-minutes are limited, and a second job
	// pays the install cost twice for the same commit. One job is the budget
	// decision, and "one status check" is what it looks like from the pull
	// request. Parsed by shape rather than with a YAML library: the workflow is
	// not a runtime dependency, so adding one to read it would be the only
	// reason it existed.
	const workflow = read(".github/workflows/ci.yml");

	it("declares exactly one job", () => {
		const jobs = workflow
			.slice(workflow.indexOf("\njobs:"))
			.split("\n")
			.filter((line) => /^ {2}[A-Za-z0-9_-]+:/.test(line));

		expect(jobs).toHaveLength(1);
	});

	it("runs install, test and build inside that one job", () => {
		for (const step of ["install", "test", "build"]) {
			expect(workflow).toContain(`- name: ${step}`);
		}
	});

	// AC-ARCH-09.2: a `push` trigger would run the whole job a second time for
	// every commit already covered by its pull request, on an account whose
	// run-minutes are capped.
	it("AC-ARCH-09.2: runs on pull requests, not on every push", () => {
		expect(workflow).toMatch(/^on:\n {2}pull_request:/m);
		expect(workflow).not.toMatch(/^ {2}push:/m);
	});

	// AC-ARCH-09.5: DEC-26 keeps lint out of the merge gate. Master carries a
	// standing lint baseline, so a lint step here would block every pull
	// request on debt that pull request did not create.
	it("AC-ARCH-09.5: runs no lint step, per DEC-26", () => {
		expect(workflow).not.toMatch(/run:.*\bnpm run lint\b/);
		expect(workflow).not.toMatch(/run:.*\beslint\b/);
	});
});

describe("AC-ARCH-06.1: one command produces a loadable plugin", () => {
	// Obsidian loads a plugin folder holding main.js and manifest.json. The
	// criterion is that `npm run build` is the whole procedure -- no manual copy
	// step, no second command someone has to remember.
	const pkg = JSON.parse(read("package.json")) as {
		scripts: Record<string, string>;
	};

	it("builds by type-checking first, then bundling for production", () => {
		expect(pkg.scripts.build).toBe(
			"npm run typecheck && node esbuild.config.mjs production",
		);
	});

	it("writes the bundle to main.js at the plugin root", () => {
		expect(read("esbuild.config.mjs")).toMatch(/outfile:\s*"main\.js"/);
	});

	it("ships the manifest beside it, with an id and a version", () => {
		const manifest = JSON.parse(read("manifest.json")) as {
			id?: string;
			version?: string;
		};

		expect(manifest.id).toBeTruthy();
		expect(manifest.version).toBeTruthy();
	});
});
