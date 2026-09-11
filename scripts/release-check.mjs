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

// The official grammar from semver.org, verbatim. A trimmed version of it accepted
// "1.0.0-01": the spec forbids a leading zero on a numeric prerelease identifier,
// and the difference matters because two versions that differ only there compare
// equal under any comparator that parses them as numbers.
const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Returns a list of human-readable problems. An empty list means the release is
 * allowed to publish. `tag` and `previousManifest` are optional: a local run has
 * no tag, and the very first release has no previous one.
 */
export function checkRelease({
	manifest,
	versions,
	tag = null,
	previousVersion = null,
	previousManifest = null,
}) {
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

	// versions.json is append-only in practice: Obsidian serves an older plugin build
	// to an older app by looking the version up here. Releasing a version that is not
	// above every entry already in the ledger leaves those clients on a build that no
	// longer exists.
	if (previousVersion && version && SEMVER.test(version) && compareSemver(previousVersion, version) >= 0) {
		problems.push(
			`versions.json already records ${JSON.stringify(previousVersion)}, which is not lower than ` +
				`this release's ${JSON.stringify(version)}. A release must move the version forward.`,
		);
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
 *
 * This returns the highest entry other than the current one, NOT the highest entry
 * below it. Filtering by "below" meant a release that went backwards found no
 * predecessor and skipped the id check — the one case where a mistake is most
 * likely. A backwards release is caught by `checkRelease` instead, which can say so.
 */
export function previousReleaseVersion(versions, currentVersion) {
	const others = Object.keys(versions).filter((v) => v !== currentVersion);
	if (others.length === 0) return null;
	return others.sort(compareSemver).at(-1);
}

/**
 * Semantic Versioning precedence, per the spec's rule 11.
 *
 * The short version this replaced compared only the three numbers, which made
 * `1.0.0-alpha` equal to `1.0.0` and turned any version carrying build metadata
 * into NaN. Both bugs had the same consequence: the previous release became
 * invisible and the manifest id stability check silently did not run.
 */
export function compareSemver(a, b) {
	// Build metadata is explicitly ignored when determining precedence (rule 10).
	const [aCore, aPre] = splitVersion(a);
	const [bCore, bPre] = splitVersion(b);

	for (let i = 0; i < 3; i++) {
		const core = compareNumericIdentifier(aCore[i], bCore[i]);
		if (core !== 0) return core;
	}

	// A version with a prerelease has lower precedence than the same core version
	// without one.
	if (aPre.length === 0 && bPre.length === 0) return 0;
	if (aPre.length === 0) return 1;
	if (bPre.length === 0) return -1;

	for (let i = 0; i < Math.max(aPre.length, bPre.length); i++) {
		// A larger set of prerelease fields wins when all the preceding ones are equal.
		if (i >= aPre.length) return -1;
		if (i >= bPre.length) return 1;

		const [x, y] = [aPre[i], bPre[i]];
		const [xNum, yNum] = [/^\d+$/.test(x), /^\d+$/.test(y)];
		if (xNum && yNum) {
			const numeric = compareNumericIdentifier(x, y);
			if (numeric !== 0) return numeric;
		} else if (xNum !== yNum) {
			// Numeric identifiers always have lower precedence than alphanumeric ones.
			return xNum ? -1 : 1;
		} else if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

/**
 * Compares two numeric version identifiers without going through Number.
 *
 * Number() is exact only below 2^53, so it ranked 9007199254740992 and
 * 9007199254740993 as the same version. Semver forbids a leading zero on a numeric
 * identifier, so the longer digit string is always the larger number and equal
 * lengths compare bytewise. Leading zeros are stripped anyway, because compareSemver
 * is also reachable with input the regex has not validated.
 */
function compareNumericIdentifier(a, b) {
	const [x, y] = [a.replace(/^0+(?=\d)/, ""), b.replace(/^0+(?=\d)/, "")];
	if (x.length !== y.length) return x.length - y.length;
	return x < y ? -1 : x > y ? 1 : 0;
}

function splitVersion(version) {
	const withoutBuild = version.split("+")[0];
	const dash = withoutBuild.indexOf("-");
	// Kept as strings: see compareNumericIdentifier.
	const core = (dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)).split(".");
	const pre = dash === -1 ? [] : withoutBuild.slice(dash + 1).split(".");
	return [core, pre];
}

/**
 * A version that already carries a tag on a different commit has been released
 * before, from different code. Anyone who downloaded it got that other build, so
 * reusing the number silently replaces what they have.
 *
 * This is the reachable half of the re-release problem. The ledger half is not:
 * previousReleaseVersion always excludes the version being released, so
 * checkRelease can never see a previous entry equal to the current one.
 */
export function checkExistingRelease(version, existingTagCommit, headCommit) {
	if (!existingTagCommit || existingTagCommit === headCommit) return null;
	return (
		`a tag ${JSON.stringify(version)} already exists at ${existingTagCommit.slice(0, 8)}, which is not ` +
		"this commit. That version was already released from different code — bump the version instead."
	);
}

function git(...args) {
	return execFileSync("git", args, { encoding: "utf8" });
}

function commitOf(ref) {
	try {
		return git("rev-parse", `${ref}^{commit}`).trim();
	} catch {
		return null;
	}
}

/**
 * The tag under test. `npm version` creates the tag on HEAD, so a local run right
 * after a version bump has a real tag to check — the README tells the release owner
 * to run this command at exactly that point, and reporting "no tag" there would
 * check less than the README claims it checks.
 */
function resolveTag(argv) {
	const tagFlag = argv.indexOf("--tag");
	if (tagFlag !== -1) return { tag: argv[tagFlag + 1], source: "--tag" };
	if (process.env.GITHUB_REF_NAME) {
		return { tag: process.env.GITHUB_REF_NAME, source: "GITHUB_REF_NAME" };
	}

	let atHead = [];
	try {
		atHead = git("tag", "--points-at", "HEAD").split("\n").filter(Boolean);
	} catch {
		return { tag: null, source: "no git" };
	}

	if (atHead.length === 1) return { tag: atHead[0], source: "tag on HEAD" };
	if (atHead.length > 1) {
		// Guessing which one is the release would be the wrong kind of helpful.
		return { tag: null, source: `ambiguous — ${atHead.length} tags on HEAD: ${atHead.join(", ")}`, ambiguous: true };
	}
	return { tag: null, source: "no tag on HEAD — checking the manifest and versions.json only" };
}

function main(argv) {
	const { tag, source, ambiguous } = resolveTag(argv);
	if (ambiguous) {
		console.error(`cannot tell which tag is the release: ${source}`);
		console.error("re-run with --tag <version>.");
		return 1;
	}

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

	console.log(`tag:             ${tag ?? "(none)"} [${source}]`);
	console.log(`manifest id:     ${manifest.id}`);
	console.log(`manifest version: ${manifest.version} (minAppVersion ${manifest.minAppVersion})`);
	console.log(`previous release: ${previousTag ?? "(none — this is the first release)"}`);

	const problems = checkRelease({ manifest, versions, tag, previousVersion: previousTag, previousManifest });

	const reReleased = checkExistingRelease(
		manifest.version,
		commitOf(manifest.version),
		commitOf("HEAD"),
	);
	if (reReleased) problems.push(reReleased);

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
