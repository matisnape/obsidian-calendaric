#!/usr/bin/env node
// Static release checks: AC-ARCH-06.2 (manifest id / semver / versions.json) and
// AC-ARCH-06.3 (the tag matches manifest.json's version, with no leading "v").
//
// Why a script rather than inline shell in release.yml: a workflow file cannot be
// unit-tested, and these rules are the part worth testing. Everything under
// `checkRelease` is pure so the tests can drive it with literals; the CLI below is
// only file and git plumbing.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

// The official semver grammar, trimmed to what a plugin version can be. Obsidian's
// own plugin validation rejects anything else.
const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Returns a list of human-readable problems. An empty list means the release is
 * allowed to publish. `tag` and `previousManifest` are optional: a local run has
 * no tag, and the very first release has no previous one.
 */
export function checkRelease({ manifest, versions, tag = null, previousManifest = null }) {
	const problems = [];
	const version = manifest?.version;

	if (!manifest?.id) {
		problems.push("manifest.json has no id.");
	}

	if (!version) {
		problems.push("manifest.json has no version.");
	} else if (!SEMVER.test(version)) {
		problems.push(
			`manifest.json version ${JSON.stringify(version)} is not semantic versioning (x.y.z).`,
		);
	}

	if (tag !== null) {
		// Called out separately from the plain mismatch because a leading "v" is the
		// one mistake AGENTS.md warns about by name, and "v0.1.0 != 0.1.0" does not
		// tell the reader that the prefix itself is the rule being broken.
		if (/^v\d/.test(tag)) {
			problems.push(
				`release tag ${JSON.stringify(tag)} has a leading "v". Obsidian requires the bare version.`,
			);
		} else if (version && tag !== version) {
			problems.push(
				`release tag ${JSON.stringify(tag)} does not match manifest.json version ${JSON.stringify(version)}.`,
			);
		}
	}

	if (version) {
		if (!Object.prototype.hasOwnProperty.call(versions ?? {}, version)) {
			problems.push(`versions.json has no entry for version ${JSON.stringify(version)}.`);
		} else if (versions[version] !== manifest.minAppVersion) {
			problems.push(
				`versions.json maps ${JSON.stringify(version)} to minAppVersion ${JSON.stringify(versions[version])}, ` +
					`but manifest.json declares ${JSON.stringify(manifest.minAppVersion)}.`,
			);
		}
	}

	// AGENTS.md: the id is stable API once a release exists. Nothing enforces that
	// but this check, because renaming it only breaks users at update time.
	if (previousManifest && previousManifest.id !== manifest?.id) {
		problems.push(
			`manifest.json id changed from ${JSON.stringify(previousManifest.id)} to ${JSON.stringify(manifest?.id)}. ` +
				"A plugin id is permanent once released.",
		);
	}

	return problems;
}

/**
 * The version of the previous release, or null when there is none.
 *
 * versions.json is the plugin's own release ledger, so it — not the git tag list —
 * decides what counts as a previous release. This repository was forked from
 * obsidian-sample-plugin and inherited its `1.0.0` tag, whose manifest.json carries
 * the id `obsidian-sample-plugin`. Reading the previous release off the tag list
 * would make that inherited tag fail the id check on this plugin's own first
 * release. It is not in versions.json, so here it is simply not a release.
 *
 * Deriving the expected tag rather than discovering it also means a checkout with
 * no tags is caught: the caller knows a tag must exist and can fail instead of
 * reporting "no previous release" for a plugin that has had several.
 */
export function previousReleaseVersion(versions, currentVersion) {
	return (
		Object.keys(versions)
			.filter((v) => compareSemver(v, currentVersion) < 0)
			.sort(compareSemver)
			.pop() ?? null
	);
}

function compareSemver(a, b) {
	const parse = (v) => v.split("-")[0].split(".").map(Number);
	const [aMajor, aMinor, aPatch] = parse(a);
	const [bMajor, bMinor, bPatch] = parse(b);
	return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}

function git(...args) {
	return execFileSync("git", args, { encoding: "utf8" });
}

function main(argv) {
	const tagFlag = argv.indexOf("--tag");
	const tag = tagFlag === -1 ? (process.env.GITHUB_REF_NAME ?? null) : argv[tagFlag + 1];

	const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
	const versions = JSON.parse(readFileSync("versions.json", "utf8"));

	let previousManifest = null;
	const previousTag = previousReleaseVersion(versions, manifest.version);
	if (previousTag) {
		try {
			previousManifest = JSON.parse(git("show", `${previousTag}:manifest.json`));
		} catch (error) {
			// A shallow checkout has the commit but not the tag. Fail here rather than
			// reporting "no previous release", which would read exactly like a passing
			// first release while the id check had quietly not run.
			console.error(`could not read manifest.json at tag ${previousTag}: ${error.message}`);
			console.error(
				"versions.json records that release, so the tag must exist. The manifest id " +
					"stability check did NOT run — check out with fetch-depth: 0.",
			);
			return 1;
		}
	}

	console.log(`tag:             ${tag ?? "(none — local run)"}`);
	console.log(`manifest id:     ${manifest.id}`);
	console.log(`manifest version: ${manifest.version} (minAppVersion ${manifest.minAppVersion})`);
	console.log(`previous release: ${previousTag ?? "(none — this is the first release)"}`);

	const problems = checkRelease({ manifest, versions, tag, previousManifest });
	if (problems.length === 0) {
		console.log("\nrelease checks passed.");
		return 0;
	}

	console.error(`\nrelease checks FAILED (${problems.length}):`);
	for (const problem of problems) console.error(`  - ${problem}`);
	return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(main(process.argv.slice(2)));
}
