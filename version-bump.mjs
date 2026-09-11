import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// read minAppVersion from manifest.json and bump version to target version
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// update versions.json with target version and minAppVersion from manifest.json,
// but only if the target version is not already in versions.json.
//
// This tested the wrong thing upstream: it looked for minAppVersion among the
// *values*, so a release that kept the same minAppVersion as any earlier release
// never got its own row. AC-ARCH-06.2 requires a row per released version, so the
// key is what has to be absent.
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!Object.prototype.hasOwnProperty.call(versions, targetVersion)) {
    versions[targetVersion] = minAppVersion;
    writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));
}
