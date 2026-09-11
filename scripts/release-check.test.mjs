import { describe, expect, it } from "vitest";
import { checkRelease, previousReleaseVersion } from "./release-check.mjs";

const manifest = {
	id: "obsidian-calendaric",
	version: "0.1.0",
	minAppVersion: "0.15.0",
};
const versions = { "0.1.0": "0.15.0" };

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

	it("rejects a version that is not semantic versioning", () => {
		const problems = checkRelease({
			manifest: { ...manifest, version: "0.1" },
			versions: { "0.1": "0.15.0" },
		});
		expect(problems).toContainEqual(expect.stringContaining("not semantic versioning"));
	});

	it("rejects a version missing from versions.json", () => {
		const problems = checkRelease({ manifest, versions: { "0.0.9": "0.15.0" } });
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
		expect(previousReleaseVersion({ "0.0.9": "0.15.0", "0.1.0": "0.15.0" }, "0.1.0")).toBe("0.0.9");
	});

	it("reports no previous release for the first entry in versions.json", () => {
		expect(previousReleaseVersion({ "0.1.0": "0.15.0" }, "0.1.0")).toBeNull();
	});

	it("picks the highest earlier release, not the first listed", () => {
		const versions = { "0.1.0": "0.15.0", "0.9.0": "0.15.0", "0.2.0": "0.15.0" };
		expect(previousReleaseVersion(versions, "1.0.0")).toBe("0.9.0");
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
