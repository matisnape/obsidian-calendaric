import { existsSync, readFileSync } from "node:fs";
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
	// Only a fingerprint: upstream's tsconfig also enables `strict` whole, and
	// the rewrite type-checks under it. The sample sets skipLibCheck in the file,
	// where this project passes it on the command line. Change this marker when
	// tsconfig.json changes on purpose.
	{ file: "tsconfig.json", sampleMarker: /"skipLibCheck"/ },
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
