import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
	checkExistingRelease,
	checkRelease,
	compareSemver,
	previousReleaseVersion,
} from "./release-check.mjs";

// Mirrors the real manifest.json and versions.json.
const manifest = {
	id: "obsidian-calendaric",
	version: "0.1.0",
	minAppVersion: "1.13.7",
};
const versions = { "0.1.0": "1.13.7" };

describe("AC-ARCH-06.2 — static manifest and versions.json checks", () => {
	it("passes on a consistent manifest, versions.json and previous release", () => {
		expect(
			checkRelease({
				manifest,
				versions,
				tag: "0.1.0",
				previousManifest: { id: "obsidian-calendaric", version: "0.0.9" },
			}),
		).toEqual([]);
	});

	it.each(["0.1", "1.0", "1.0.0.0", "01.0.0", "1.0.0-01", "1.0.0-", "v1.0.0", ""])(
		"rejects %o as a version",
		(version) => {
			const problems = checkRelease({ manifest: { ...manifest, version }, versions: {} });
			expect(problems.join(" ")).toMatch(/not semantic versioning|has no version/);
		},
	);

	it.each(["1.0.0", "0.1.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-0.3.7", "1.0.0+build.1"])(
		"accepts %o as a version",
		(version) => {
			const problems = checkRelease({ manifest: { ...manifest, version }, versions: { [version]: "1.13.7" } });
			expect(problems).toEqual([]);
		},
	);

	it("rejects a version missing from versions.json", () => {
		const problems = checkRelease({ manifest, versions: { "0.0.9": "1.13.7" } });
		expect(problems).toContainEqual(expect.stringContaining("versions.json has no entry"));
	});

	it("rejects a versions.json minAppVersion that disagrees with the manifest", () => {
		const problems = checkRelease({ manifest, versions: { "0.1.0": "1.0.0" } });
		expect(problems).toContainEqual(expect.stringContaining("but manifest.json declares"));
	});

	it("rejects a changed plugin id", () => {
		const problems = checkRelease({
			manifest,
			versions,
			previousManifest: { id: "obsidian-sample-plugin" },
		});
		expect(problems).toContainEqual(expect.stringContaining("id changed"));
	});

	it("skips the id check when there is no previous release", () => {
		expect(checkRelease({ manifest, versions, previousManifest: null })).toEqual([]);
	});

	it("reads the previous release out of versions.json, not the git tag list", () => {
		// The fork inherited obsidian-sample-plugin's 1.0.0 tag. versions.json is this
		// plugin's own ledger, so that tag is not a release of this plugin at all.
		expect(previousReleaseVersion({ "0.0.9": "1.13.7", "0.1.0": "1.13.7" }, "0.1.0")).toBe("0.0.9");
	});

	it("reports no previous release for the first entry in versions.json", () => {
		expect(previousReleaseVersion({ "0.1.0": "1.13.7" }, "0.1.0")).toBeNull();
	});

	it("picks the highest earlier release, not the first listed", () => {
		const versions = { "0.1.0": "1.13.7", "0.9.0": "1.13.7", "0.2.0": "1.13.7" };
		expect(previousReleaseVersion(versions, "1.0.0")).toBe("0.9.0");
	});

	it("still finds a predecessor when the release goes backwards", () => {
		// Filtering to entries below the current version returned null here, which
		// skipped the id check on exactly the release most likely to be a mistake.
		expect(previousReleaseVersion({ "0.9.0": "1.13.7" }, "0.2.0")).toBe("0.9.0");
	});

	it("rejects a release that does not move the version forward", () => {
		const problems = checkRelease({
			manifest: { ...manifest, version: "0.2.0" },
			versions: { "0.9.0": "1.13.7", "0.2.0": "1.13.7" },
			previousVersion: "0.9.0",
		});
		expect(problems).toContainEqual(expect.stringContaining("must move the version forward"));
	});

	it("rejects a version whose tag already exists on another commit", () => {
		// The reachable form of a re-release: previousReleaseVersion always excludes
		// the version being released, so checkRelease can never be handed a previous
		// entry equal to the current one.
		expect(checkExistingRelease("0.1.0", "aaaaaaaabbbbbbbb", "ccccccccdddddddd")).toContain(
			"already exists at aaaaaaaa",
		);
	});

	it("accepts a tag that points at the commit being released", () => {
		expect(checkExistingRelease("0.1.0", "aaaaaaaabbbbbbbb", "aaaaaaaabbbbbbbb")).toBeNull();
	});

	it("accepts a version that has never been tagged", () => {
		expect(checkExistingRelease("0.1.0", null, "ccccccccdddddddd")).toBeNull();
	});

	it("checks the id against a prerelease predecessor", () => {
		// compareSemver used to rank 1.0.0-rc.1 equal to 1.0.0, so this predecessor
		// was invisible and the id check did not run.
		const problems = checkRelease({
			manifest: { ...manifest, version: "1.0.0" },
			versions: { "1.0.0-rc.1": "1.13.7", "1.0.0": "1.13.7" },
			previousVersion: "1.0.0-rc.1",
			previousManifest: { id: "obsidian-sample-plugin" },
		});
		expect(problems).toContainEqual(expect.stringContaining("id changed"));
	});
});

describe("AC-ARCH-06.3 — the release tag matches manifest.json's version", () => {
	it("accepts a tag equal to the manifest version", () => {
		expect(checkRelease({ manifest, versions, tag: "0.1.0" })).toEqual([]);
	});

	it("rejects a tag with a leading v", () => {
		const problems = checkRelease({ manifest, versions, tag: "v0.1.0" });
		expect(problems).toContainEqual(expect.stringContaining('leading "v"'));
	});

	it("rejects a tag that names a different version", () => {
		const problems = checkRelease({ manifest, versions, tag: "0.2.0" });
		expect(problems).toContainEqual(expect.stringContaining("does not match manifest.json version"));
	});

	it("rejects the inherited 1.0.0 tag against today's manifest", () => {
		// The tag already exists locally. Pushing it must not publish a release.
		const problems = checkRelease({ manifest, versions, tag: "1.0.0" });
		expect(problems).toContainEqual(expect.stringContaining("does not match manifest.json version"));
	});
});

describe("AC-ARCH-06.2 — compareSemver, Semantic Versioning precedence (spec rule 11)", () => {
	it.each([
		["1.0.0", "2.0.0"],
		["2.0.0", "2.1.0"],
		["2.1.0", "2.1.1"],
		["1.0.0-alpha", "1.0.0"],
		["1.0.0-alpha", "1.0.0-alpha.1"],
		["1.0.0-alpha.1", "1.0.0-alpha.beta"],
		["1.0.0-alpha.beta", "1.0.0-beta"],
		["1.0.0-beta", "1.0.0-beta.2"],
		["1.0.0-beta.2", "1.0.0-beta.11"],
		["1.0.0-beta.11", "1.0.0-rc.1"],
		["1.0.0-rc.1", "1.0.0"],
	])("ranks %o below %o", (lower, higher) => {
		expect(compareSemver(lower, higher)).toBeLessThan(0);
		expect(compareSemver(higher, lower)).toBeGreaterThan(0);
	});

	it("ignores build metadata, which carries no precedence", () => {
		expect(compareSemver("1.0.0+build.1", "1.0.0+build.99")).toBe(0);
		expect(compareSemver("1.0.0+build.1", "1.0.0")).toBe(0);
		// The previous comparator turned this into NaN and silently ranked nothing.
		expect(compareSemver("1.0.1+build.1", "1.0.0")).toBeGreaterThan(0);
	});

	it("does not collapse version numbers above 2^53", () => {
		// Number() is exact only below 2^53, so these two parsed to the same value and
		// the comparator ranked them equal.
		expect(compareSemver("1.0.9007199254740992", "1.0.9007199254740993")).toBeLessThan(0);
		expect(compareSemver("9007199254740993.0.0", "9007199254740992.0.0")).toBeGreaterThan(0);
		expect(compareSemver("1.0.0-9007199254740992", "1.0.0-9007199254740993")).toBeLessThan(0);
	});

	it("compares numeric identifiers by value, not by digit string", () => {
		expect(compareSemver("1.0.10", "1.0.9")).toBeGreaterThan(0);
		expect(compareSemver("1.0.0-2", "1.0.0-11")).toBeLessThan(0);
	});

	it("sorts a ledger the way the release checks rely on", () => {
		const sorted = ["1.0.0", "0.2.0", "1.0.0-rc.1", "0.10.0"].sort(compareSemver);
		expect(sorted).toEqual(["0.2.0", "0.10.0", "1.0.0-rc.1", "1.0.0"]);
	});
});

// Drives the real CLI in a throwaway repository. The unit tests above cannot see
// this defect: it lives in which git ref the CLI asks for, not in any pure function.
describe("AC-ARCH-06.2 — the re-release check reads a tag, not a same-named branch", () => {
	const script = fileURLToPath(new URL("release-check.mjs", import.meta.url));
	const repos = [];

	afterAll(() => repos.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

	// A temporary repository must not inherit the caller's GITHUB_* or GIT_* variables.
	// On a pull_request event GITHUB_REF_NAME is "<number>/merge", which the checker
	// read as the release tag, so this block passed locally and failed in CI. GIT_DIR
	// and its siblings would redirect these git calls out of the temporary repository
	// the same way.
	const HERMETIC_ENV = Object.fromEntries(
		Object.entries(process.env).filter(
			([name]) => !name.startsWith("GITHUB_") && !name.startsWith("GIT_"),
		),
	);

	function git(dir, ...args) {
		execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...args], {
			stdio: "pipe",
			env: HERMETIC_ENV,
		});
	}

	/** A repository whose HEAD is one commit past a ref named "0.1.0". */
	function repoWithRefNamedAfterTheVersion(makeRef) {
		const dir = mkdtempSync(join(tmpdir(), "release-check-"));
		repos.push(dir);
		copyFileSync(script, join(dir, "release-check.mjs"));
		writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
		writeFileSync(join(dir, "versions.json"), JSON.stringify(versions));
		git(dir, "init", "-q", "-b", "main");
		git(dir, "add", "-A");
		git(dir, "commit", "-qm", "release 0.1.0");
		makeRef(dir);
		writeFileSync(join(dir, "note.txt"), "later work");
		git(dir, "add", "-A");
		git(dir, "commit", "-qm", "work after the ref");
		return dir;
	}

	function runCheck(dir, extraEnv = {}) {
		// stdio must be spelled out. execFileSync inherits the child's stderr by
		// default, so the expected-failure case below printed release-check's failure
		// message onto the test gate's own stderr — which reads exactly like the real
		// repository failing its release check, for a tag that only ever existed in a
		// temporary repository.
		const stdio = ["ignore", "pipe", "pipe"];
		try {
			const env = { ...HERMETIC_ENV, ...extraEnv };
			const out = execFileSync("node", ["release-check.mjs"], { cwd: dir, encoding: "utf8", stdio, env });
			return { status: 0, out };
		} catch (error) {
			return { status: error.status, out: `${error.stdout}${error.stderr}` };
		}
	}

	it("passes when only a branch carries the version's name", () => {
		// git resolves an unqualified "0.1.0" against refs/heads/ as well, so this
		// branch used to look like an existing release and failed the check.
		const dir = repoWithRefNamedAfterTheVersion((d) => git(d, "branch", "0.1.0"));
		const { status, out } = runCheck(dir);
		expect(out).toContain("release checks passed");
		expect(status).toBe(0);
	});

	it("still fails when a real tag for the version sits on another commit", () => {
		const dir = repoWithRefNamedAfterTheVersion((d) => git(d, "tag", "0.1.0"));
		const { status, out } = runCheck(dir);
		expect(out).toContain("already exists at");
		expect(status).toBe(1);
	});

	describe("AC-ARCH-06.3 — the release tag comes from a tag ref, not any ambient ref", () => {
		it("ignores a pull-request merge ref", () => {
			// What CI actually sets on a pull_request event. Reading the name alone
			// made the checker compare manifest.json against "9/merge".
			const dir = repoWithRefNamedAfterTheVersion((d) => git(d, "branch", "0.1.0"));
			const { status, out } = runCheck(dir, {
				GITHUB_REF: "refs/pull/9/merge",
				GITHUB_REF_NAME: "9/merge",
			});
			expect(out).not.toContain("9/merge");
			expect(out).toContain("release checks passed");
			expect(status).toBe(0);
		});

		it("ignores a branch ref", () => {
			const dir = repoWithRefNamedAfterTheVersion((d) => git(d, "branch", "0.1.0"));
			const { status } = runCheck(dir, {
				GITHUB_REF: "refs/heads/main",
				GITHUB_REF_NAME: "main",
			});
			expect(status).toBe(0);
		});

		it("still reads the tag when the ref is a tag ref", () => {
			const dir = repoWithRefNamedAfterTheVersion((d) => git(d, "branch", "0.1.0"));
			const { status, out } = runCheck(dir, {
				GITHUB_REF: "refs/tags/0.2.0",
				GITHUB_REF_NAME: "0.2.0",
			});
			expect(out).toContain('release tag "0.2.0" does not match manifest.json version "0.1.0"');
			expect(status).toBe(1);
		});
	});
}, 20000);
