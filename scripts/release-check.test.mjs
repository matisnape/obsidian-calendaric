import { describe, expect, it } from "vitest";
import { checkRelease, compareSemver, previousReleaseVersion } from "./release-check.mjs";

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

	it("rejects re-releasing a version already in the ledger", () => {
		const problems = checkRelease({ manifest, versions, previousVersion: "0.1.0" });
		expect(problems).toContainEqual(expect.stringContaining("must move the version forward"));
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

describe("compareSemver — Semantic Versioning precedence, spec rule 11", () => {
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

	it("sorts a ledger the way the release checks rely on", () => {
		const sorted = ["1.0.0", "0.2.0", "1.0.0-rc.1", "0.10.0"].sort(compareSemver);
		expect(sorted).toEqual(["0.2.0", "0.10.0", "1.0.0-rc.1", "1.0.0"]);
	});
});
