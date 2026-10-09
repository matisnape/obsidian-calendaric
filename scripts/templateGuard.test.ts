import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// This repository is a fork of obsidianmd/obsidian-sample-plugin. A merge from
// that template, or a file copied over from it, would bring the sample's
// boilerplate back over files this project rewrote on purpose. Each check below
// looks for a marker that only one side has, and its title names the file, so
// a failing run says which file was overwritten. The reasoning per file is in
// docs/upstream-template-review.md.
//
// Markers are things the sample has and the rewrite must not, so a rename
// inside the rewrite does not trip them. A file that no longer exists passes:
// moving it is a refactor, not a revert.

const root = (path: string): string =>
	fileURLToPath(new URL(`../${path}`, import.meta.url));

const read = (path: string): string | undefined =>
	existsSync(root(path)) ? readFileSync(root(path), "utf8") : undefined;

const guards: { file: string; sampleMarker: RegExp }[] = [
	{ file: "src/main.ts", sampleMarker: /\b(MyPlugin|SampleModal|SampleSettingTab)\b/ },
	{ file: "src/settings.ts", sampleMarker: /\b(MyPluginSettings|SampleSettingTab|mySetting)\b/ },
	// A plugin id must never change after release.
	{ file: "manifest.json", sampleMarker: /"id":\s*"sample-plugin"/ },
	// Keys that only the sample sets: the fork point's piecemeal strict flags,
	// which a revert would bring back in place of `strict`, and upstream's own
	// additions. Change this marker when tsconfig.json changes on purpose.
	{
		file: "tsconfig.json",
		sampleMarker:
			/"(noImplicitAny|noImplicitThis|strictNullChecks|strictBindCallApply|useUnknownInCatchVariables|skipLibCheck|forceConsistentCasingInFileNames)"/,
	},
];

describe("AC-ARCH-10.4: a file this project rewrote is not reverted to the sample template", () => {
	for (const { file, sampleMarker } of guards) {
		it(`AC-ARCH-10.4: ${file} carries no sample-template marker`, () => {
			const text = read(file);
			if (text === undefined) return;

			expect(
				text.match(sampleMarker)?.[0],
				`${file} looks reverted to the sample template`,
			).toBeUndefined();
		});
	}
});

// Every source file, not only the guarded two: a sample class copied into a new
// file is a revert too.
const sampleClass = /\b(MyPlugin|MyPluginSettings|SampleModal|SampleSettingTab|mySetting)\b/;

describe("AC-ARCH-10.3: no file under src/ carries the sample plugin's code", () => {
	const files = readdirSync(root("src"), { recursive: true, encoding: "utf8" })
		.filter((path) => path.endsWith(".ts"));

	it("AC-ARCH-10.3: src/ has source files to check", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const path of files) {
		it(`AC-ARCH-10.3: src/${path} names no sample-plugin class`, () => {
			const text = readFileSync(root(`src/${path}`), "utf8");
			expect(text.match(sampleClass)?.[0], `src/${path}`).toBeUndefined();
		});
	}
});

// The review doc is the record AC-ARCH-10.1 and 10.2 ask for. Unlike the guards
// above, a missing doc fails: the record is the deliverable.
const review = (): string => readFileSync(root("docs/upstream-template-review.md"), "utf8");

const cells = (line: string): string[] =>
	line.split("|").slice(1, -1).map((cell) => cell.trim());

// Hardcoded from `git diff --name-only dc2fa22 upstream/master`, so a doc that
// drops a row cannot also shrink the list it is checked against.
const templateChanged = [
	".editorconfig",
	".github/workflows/lint.yml",
	".github/workflows/release.yml",
	"AGENTS.md",
	"LICENSE",
	"README.md",
	"esbuild.config.mjs",
	"eslint.config.mts",
	"manifest.json",
	"package-lock.json",
	"package.json",
	"src/main.ts",
	"src/settings.ts",
	"tsconfig.json",
	"version-bump.mjs",
	"versions.json",
];

describe("AC-ARCH-10.1: every file the template changed is classified with a reason", () => {
	for (const file of templateChanged) {
		it(`AC-ARCH-10.1: ${file} has a verdict and a reason`, () => {
			const row = review().split("\n").find((line) => line.startsWith(`| \`${file}\` |`));
			expect(row, `no row for ${file}`).toBeDefined();
			const [, verdict, reason] = cells(row ?? "");
			expect(verdict).toMatch(/^(Taken|Superseded|Declined)\b/);
			expect(reason, `${file} has no reason`).not.toBe("");
		});
	}
});

describe("AC-ARCH-10.2: the lint record holds both totals and names every rule that moved", () => {
	const lint = (): string => review().split("## Lint")[1] ?? "";

	// One row per rule and severity: [rule, severity, master, bump only, final].
	const rows = (): string[][] =>
		lint().split("\n")
			.filter((line) => /^\| .+ \| (error|warning) \|/.test(line))
			.map(cells);

	const total = (label: string): [number, number] => {
		const match = lint().match(new RegExp(`^- \\*\\*${label}\\b.*?(\\d+) errors, (\\d+) warnings`, "m"));
		expect(match, `no ${label} total`).not.toBeNull();
		return [Number(match?.[1]), Number(match?.[2])];
	};

	const sum = (column: number): [number, number] =>
		(["error", "warning"] as const).map((severity) => rows()
			.filter((row) => row[1] === severity)
			.reduce((n, row) => n + Number(row[column]), 0)) as [number, number];

	it("AC-ARCH-10.2: the master and final totals match the per-rule table", () => {
		expect(rows().length).toBeGreaterThan(0);
		expect(sum(2)).toEqual(total("Master"));
		expect(sum(4)).toEqual(total("Final"));
	});

	it("AC-ARCH-10.2: each rule that appeared, rose or disappeared is named below the table", () => {
		const explained = lint().split("### Rules that disappeared")[1] ?? "";
		for (const [rule = "", , master, , final] of rows()) {
			if (master === final) continue;
			expect(explained, `${rule} moved and is not explained`).toContain(rule.replace(/`/g, ""));
		}
	});
});
