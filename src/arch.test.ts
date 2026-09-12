/* eslint-disable import/no-nodejs-modules -- That rule guards the BUNDLE: a
   plugin shipping node:fs breaks on Obsidian mobile and fails community review.
   This file is a test, esbuild never sees it, and reading the repository's own
   configuration is the whole point of it. */
import { readdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";
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

describe("AC-ARCH-07.4: one module reads Obsidian's internal plugin registry", () => {
	// `app.internalPlugins` is undocumented and moves between Obsidian versions,
	// which is the whole reason the adapter exists. Reaching for it is only worth
	// the risk while exactly one file has to change when the host changes: a
	// second reader turns every Obsidian release into a hunt through the tree.
	//
	// Read as source text rather than by import graph, because the shape that
	// breaks is a property name in a string-indexed read, which no type can see.
	const SURFACE = /\binternalPlugins\b/;
	const ADAPTER = "src/adapters/obsidianCompanionPluginAdapter.ts";

	// Tests and the Obsidian mock are excluded on purpose: they stand in for the
	// host, so naming the surface is what they are for. This asserts about what
	// ships in the bundle.
	const shipped = readdirSync(root("src"), { recursive: true, encoding: "utf8" })
		.map((entry) => `src/${entry.split(sep).join("/")}`)
		.filter((path) => path.endsWith(".ts"))
		.filter((path) => !path.endsWith(".test.ts"))
		.filter((path) => !path.includes("/__mocks__/"))
		.sort();

	it("the adapter is the module that reads it", () => {
		expect(shipped).toContain(ADAPTER);
		expect(read(ADAPTER)).toMatch(SURFACE);
	});

	it("no other shipped module reads that surface directly", () => {
		const others = shipped.filter((path) => path !== ADAPTER);

		expect(others.filter((path) => SURFACE.test(read(path)))).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// US-ARCH-01: one allowed direction between the layers.
//
// Everything below asserts DIRECTION. None of it names the current import list
// of a particular file, because two sibling branches are editing files this
// covers right now and a check written against today's text would be stale
// before it merged.
//
// Why a test and not an eslint rule. `@typescript-eslint/no-restricted-imports`
// can express these zones and can honour `allowTypeImports`, so the rule is
// expressible there. It would not be ENFORCED there: DEC-26 keeps lint out of
// the merge gate (AC-ARCH-09.5 above asserts that), and master carries a
// standing lint baseline, so a boundary break would land in a report no pull
// request blocks on. `npm test` is the gate, so the boundary lives in a test.
// ---------------------------------------------------------------------------

/**
 * The layers, as this repository is arranged rather than as a diagram would
 * like it to be.
 *
 *   lifecycle    src/main.ts -- the composition root
 *   view         src/ui/**, the settings tab, and the cards and modals it draws
 *   domain       date and period logic, note logic, the configuration model
 *   port         an interface over a host capability, carrying no implementation
 *   adapter      the story's vault-IO layer: one implementation per host API
 *   integration  the cross-plugin boundary: the companion port and its adapter
 */
type Layer = "lifecycle" | "view" | "domain" | "port" | "adapter" | "integration";

/** Every layer a module may be imported FROM. `lifecycle` is not one: nothing may import it. */
const ALL_LAYERS: readonly Layer[] = ["view", "domain", "port", "adapter", "integration"];

const LIFECYCLE = "src/main.ts";

/**
 * A module holding a real host API call. The host it speaks to is the first
 * word of its name, which is what keeps this structural: an adapter written
 * tomorrow is classified by being named like one, with no list here to edit.
 */
const isConcreteAdapter = (path: string): boolean =>
	/^src\/adapters\/[a-z][A-Za-z0-9]*Adapter\.ts$/.test(path);

/**
 * One static import or re-export, up to its module specifier.
 *
 * The `type` group is the distinction every criterion here turns on: TypeScript
 * erases `import type` before esbuild sees the module, so it creates no edge at
 * runtime and no code in the bundle. Reporting one as a dependency would fail
 * files this repository is deliberately written to allow.
 */
const IMPORT_STATEMENT = /^[ \t]*(?:import|export)\s+(type\s+)?(?:[^;]*?\s)?from\s*["']([^"']+)["']/gm;

interface Reference {
	readonly specifier: string;
	/** The repository path the specifier resolves to, or null when it leaves src. */
	readonly module: string | null;
	readonly typeOnly: boolean;
}

const resolveModule = (from: string, specifier: string): string | null => {
	if (!specifier.startsWith(".")) return null;
	const parts = from.split("/").slice(0, -1);
	for (const segment of specifier.split("/")) {
		if (segment === ".") continue;
		if (segment === "..") parts.pop();
		else parts.push(segment);
	}
	return `${parts.join("/")}.ts`;
};

const referencesOf = (path: string): Reference[] => {
	const source = read(path);
	const found: Reference[] = [];
	IMPORT_STATEMENT.lastIndex = 0;
	let match = IMPORT_STATEMENT.exec(source);
	while (match !== null) {
		const specifier = match[2] ?? "";
		found.push({
			specifier,
			module: resolveModule(path, specifier),
			typeOnly: match[1] !== undefined,
		});
		match = IMPORT_STATEMENT.exec(source);
	}
	return found;
};

interface Edge {
	readonly from: string;
	readonly to: string;
	readonly typeOnly: boolean;
}

// `src/ui/test-setup.ts` is vitest.config.ts's setupFiles entry. esbuild bundles
// what src/main.ts reaches and nothing else, so it never ships and belongs to no
// layer.
const LAYERED = readdirSync(root("src"), { recursive: true, encoding: "utf8" })
	.map((entry) => `src/${entry.split(sep).join("/")}`)
	.filter((path) => path.endsWith(".ts"))
	.filter((path) => !path.endsWith(".test.ts"))
	.filter((path) => !path.includes("/__mocks__/"))
	.filter((path) => path !== "src/ui/test-setup.ts")
	.sort();

const EDGES: Edge[] = LAYERED.flatMap((from) =>
	referencesOf(from).flatMap((ref) =>
		ref.module === null ? [] : [{ from, to: ref.module, typeOnly: ref.typeOnly }],
	),
);

/**
 * The cross-plugin port: the one module where another plugin's shape is written
 * down, and the only type any other layer may hold that shape as.
 */
const COMPANION_PORT = "src/adapters/companionPluginPort.ts";

/**
 * The integration layer, DERIVED rather than listed: the cross-plugin port, plus
 * every module under src/adapters/ that depends on it.
 *
 * An adapter is in this layer because it implements one of that port's
 * interfaces, which is what being a cross-plugin adapter means here. Naming the
 * layer this way is what makes it survive a plugin being added -- an adapter for
 * a fourth companion lands in the integration layer by importing the port, with
 * nothing to edit in this file. Spelling it as a name pattern is what went
 * stale: obsidianPeriodicNotesAdapter.ts landed reading a plugin registry and
 * was classified as ordinary vault IO, because its name says nothing about
 * which side of the plugin boundary it stands on.
 *
 * Scoped to src/adapters/ on purpose. Domain and view modules import the port
 * too -- that is the allowed direction, not membership of this layer.
 */
const INTEGRATION: ReadonlySet<string> = new Set([
	COMPANION_PORT,
	...LAYERED.filter(
		(path) =>
			path.startsWith("src/adapters/") &&
			referencesOf(path).some((ref) => ref.module === COMPANION_PORT),
	),
]);

const layerOf = (path: string): Layer => {
	if (path === LIFECYCLE) return "lifecycle";
	if (INTEGRATION.has(path)) return "integration";
	if (path.startsWith("src/adapters/")) return isConcreteAdapter(path) ? "adapter" : "port";
	if (path.startsWith("src/ui/")) return "view";
	// src/settings.ts IS the settings tab. Under src/settings/ a Card or a Modal
	// draws, and everything else is the configuration model, which is pure. A
	// new file there counts as domain until its name says it draws -- so an
	// impure one fails AC-ARCH-01.2 loudly instead of passing unclassified.
	if (path === "src/settings.ts") return "view";
	return /^src\/settings\/\w+(Card|Modal)\.ts$/.test(path) ? "view" : "domain";
};

/**
 * The check itself: every runtime import of a concrete adapter made by a module
 * other than the composition root, reported as "<offending file> -> <import>".
 *
 * Taking edges as an argument rather than reading EDGES is what lets
 * AC-ARCH-01.4 be tested rather than argued: the same derivation runs over a
 * tree carrying one extra import.
 */
const adapterWiring = (edges: readonly Edge[]): string[] =>
	edges
		.filter((edge) => !edge.typeOnly && isConcreteAdapter(edge.to) && edge.from !== LIFECYCLE)
		.map((edge) => `${edge.from} -> ${edge.to}`)
		.sort();

describe("AC-ARCH-01.1: only the lifecycle module names an implementation", () => {
	// The whole rule, stated once: view and domain see a PORT, and src/main.ts
	// is the only module allowed to name the adapter behind it. Both halves of
	// AC-ARCH-01.1 fall out of that, because the vault-IO layer and the
	// cross-plugin-integration layer are each reached the same way.
	//
	// Asserted as an exact list rather than a ceiling: a fifth edge fails here,
	// and so does paying one of these four off without deleting its line, which
	// is what keeps the list from quietly becoming a licence.
	const KNOWN_DEBT = [
		"src/ui/calendar.ts -> src/adapters/obsidianVaultAdapter.ts",
		"src/ui/calendar.ts -> src/adapters/obsidianVaultConfigAdapter.ts",
		"src/ui/calendar.ts -> src/adapters/obsidianWorkspaceAdapter.ts",
		"src/ui/calendarDots.ts -> src/adapters/obsidianVaultConfigAdapter.ts",
	];

	it("AC-ARCH-01.1: no module outside src/main.ts constructs an adapter, beyond the four on record", () => {
		expect(adapterWiring(EDGES)).toEqual(KNOWN_DEBT);
	});

	it("AC-ARCH-01.4: a new view-to-vault-IO import fails the check, named by file and by import", () => {
		const offence: Edge = {
			from: "src/ui/newPane.ts",
			to: "src/adapters/obsidianVaultAdapter.ts",
			typeOnly: false,
		};

		const reported = adapterWiring([...EDGES, offence]);

		expect(reported).not.toEqual(KNOWN_DEBT);
		expect(reported).toContain("src/ui/newPane.ts -> src/adapters/obsidianVaultAdapter.ts");
	});
});

describe("AC-ARCH-01.2: the domain layer runs without a host", () => {
	const domain = LAYERED.filter((path) => layerOf(path) === "domain");

	// A classifier bug that emptied this set would make both assertions below
	// pass while checking nothing, which is the failure this file exists to
	// prevent elsewhere.
	it("describes a layer that has modules in it", () => {
		expect(domain.length).toBeGreaterThan(5);
	});

	it('AC-ARCH-01.2: imports nothing from "obsidian" at runtime', () => {
		const offenders = domain.filter((path) =>
			referencesOf(path).some((ref) => !ref.typeOnly && ref.specifier === "obsidian"),
		);

		expect(offenders).toEqual([]);
	});

	it("AC-ARCH-01.2: imports no adapter module and no view module", () => {
		const offenders = EDGES.filter((edge) => layerOf(edge.from) === "domain")
			.filter((edge) => isConcreteAdapter(edge.to) || layerOf(edge.to) === "view")
			.map((edge) => `${edge.from} -> ${edge.to}`);

		expect(offenders).toEqual([]);
	});
});

describe("AC-ARCH-01.3: the lifecycle module is the composition root, and a sink", () => {
	const layersReachedBy = (path: string): Set<Layer> =>
		new Set(
			EDGES.filter((edge) => edge.from === path)
				.map((edge) => layerOf(edge.to))
				.filter((layer) => layer !== "lifecycle"),
		);

	it("AC-ARCH-01.3: src/main.ts imports from every layer", () => {
		expect([...layersReachedBy(LIFECYCLE)].sort()).toEqual([...ALL_LAYERS].sort());
	});

	it("AC-ARCH-01.3: no other module imports from every layer", () => {
		const spanning = LAYERED.filter((path) => path !== LIFECYCLE).filter((path) => {
			const reached = layersReachedBy(path);
			return ALL_LAYERS.every((layer) => reached.has(layer));
		});

		expect(spanning).toEqual([]);
	});

	// Three modules import the plugin class as a TYPE -- the settings tab, the
	// import card and the calendar view all take it as a constructor argument.
	// That import is erased before the bundle exists, so it is not the cycle the
	// criterion forbids. A runtime import would be, and is what this catches.
	it("AC-ARCH-01.3: nothing imports the lifecycle module at runtime", () => {
		const importers = EDGES.filter((edge) => edge.to === LIFECYCLE && !edge.typeOnly).map(
			(edge) => edge.from,
		);

		expect(importers).toEqual([]);
	});
});

describe("AC-ARCH-01.5: a companion plugin is reached only as a typed port", () => {
	const PORT = COMPANION_PORT;

	// What the criterion forbids is OBTAINING a companion plugin's state outside
	// this boundary, and a plugin id alone obtains nothing. The first version of
	// this check matched the id wherever it appeared, and fired on
	// src/settings/importSource.ts, whose `{ source: "periodic-notes" }` is the
	// discriminant tag of a result union -- correct code, reported as a
	// violation. A check that fires on correct code is a check the next person
	// deletes, so the two are told apart here.
	//
	// Two surfaces, because obtaining the state takes both and either one alone
	// is enough to catch it:

	// One: the registry itself, in every form this codebase reaches it by --
	// `app.internalPlugins`, the string-indexed `["plugins"]` hop a narrowing
	// adapter uses, and the lookup methods either registry answers to.
	const PLUGIN_REGISTRY = /\binternalPlugins\b|\.plugins\b|\[\s*["']plugins["']\s*\]|\bgetPluginById\b|\bgetPlugin\b/;

	// Two: an id used AS a lookup -- indexing something with it, passing it as a
	// call's argument, or comparing a value against it. A tag is none of those:
	// it sits after a `:` or a `|`, which no branch below matches.
	const COMPANION_IDS = "daily-notes|periodic-notes-anks|periodic-notes|templater-obsidian";
	const ID_AS_LOOKUP = new RegExp(
		[
			`[\\w)\\]]\\[\\s*["'](?:${COMPANION_IDS})["']`, // registry["periodic-notes"]
			`\\(\\s*["'](?:${COMPANION_IDS})["']\\s*[,)]`, // getPluginById("daily-notes")
			`[=!]==?\\s*["'](?:${COMPANION_IDS})["']`, // id === "periodic-notes"
			`["'](?:${COMPANION_IDS})["']\\s*[=!]==?`, // "periodic-notes" === id
		].join("|"),
	);

	it("AC-ARCH-01.5: no layer but the integration layer looks a companion plugin up", () => {
		const outside = LAYERED.filter((path) => layerOf(path) !== "integration").filter((path) => {
			const source = read(path);
			return PLUGIN_REGISTRY.test(source) || ID_AS_LOOKUP.test(source);
		});

		expect(outside).toEqual([]);
	});

	// The pair above is only worth having while it still fires. Both halves are
	// checked against text rather than against the tree, so that a rewrite that
	// narrowed either one into uselessness fails here and not silently.
	it("AC-ARCH-01.5: the lookup patterns tell a lookup from a tag", () => {
		const lookups = [
			'const registry = (app as Record<string, unknown>)["plugins"];',
			'const plugin = registry["periodic-notes"];',
			'app.internalPlugins.getPluginById("daily-notes");',
			'if (id === "periodic-notes") return true;',
		];
		const tags = [
			'export type ImportSource = { source: "periodic-notes" } | { source: "daily-notes" };',
			'return { source: "periodic-notes" };',
			'const label: Record<string, string> = { "daily-notes": "Daily Notes" };',
		];

		expect(lookups.filter((line) => !PLUGIN_REGISTRY.test(line) && !ID_AS_LOOKUP.test(line))).toEqual([]);
		expect(tags.filter((line) => PLUGIN_REGISTRY.test(line) || ID_AS_LOOKUP.test(line))).toEqual([]);
	});

	it("AC-ARCH-01.5: every other layer takes the port, never the adapter", () => {
		const consumers = EDGES.filter(
			(edge) =>
				layerOf(edge.to) === "integration" &&
				layerOf(edge.from) !== "integration" &&
				edge.from !== LIFECYCLE,
		);

		expect(consumers.filter((edge) => edge.to !== PORT).map((edge) => `${edge.from} -> ${edge.to}`)).toEqual([]);
		expect(consumers.length).toBeGreaterThan(0);
	});

	// Asserted by shape, not by method name: a sibling branch is adding
	// operations to this interface, and a check listing today's members would
	// fail on work that is exactly what the port is for.
	it("AC-ARCH-01.5: the port exports typed operations and nothing untyped", () => {
		const body = /export interface CompanionPluginPort\s*\{([\s\S]*?)\n\}/.exec(read(PORT));

		expect(body).not.toBeNull();

		const members = (body?.[1] ?? "")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("*") && !line.startsWith("/"));

		expect(members.length).toBeGreaterThan(0);
		expect(members.filter((member) => !/^\w+\([^)]*\):\s*\S+;$/.test(member))).toEqual([]);
	});
});

describe("AC-ARCH-01.6: the desktop-only surface sits behind one named adapter", () => {
	// Electron's shell, Node's builtins and the desktop file-system adapter's
	// basePath all exist on desktop and not on mobile. A view module that
	// reaches for one crashes the pane it drew as soon as a phone opens it.
	const DESKTOP_ONLY =
		/\brequire\(\s*["']electron["']\s*\)|\bFileSystemAdapter\b|\bbasePath\b|\bnode:[a-z_]+\b|\bchild_process\b|\b__dirname\b|\bprocess\.(platform|env|cwd)\b/;
	const BOUNDARY = "src/adapters/electronDesktopShellAdapter.ts";

	it("AC-ARCH-01.6: one module holds every desktop-only import and call", () => {
		expect(LAYERED.filter((path) => DESKTOP_ONLY.test(read(path)))).toEqual([BOUNDARY]);
	});

	it("AC-ARCH-01.6: the view depends on that boundary's interface, never on the API", () => {
		const importers = EDGES.filter((edge) => edge.to === BOUNDARY && !edge.typeOnly).map(
			(edge) => edge.from,
		);

		expect(importers).toEqual([LIFECYCLE]);
	});
});
