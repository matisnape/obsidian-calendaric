// A complete `SettingsTabPorts` for a test, built from defaults.
//
// This exists because of a failure no single branch could see. Two stories in
// one wave widened `SettingsTabPorts` -- US-TPL-04 with `vault`, US-MIG-04 with
// `periodicNotes` -- on different lines. Git merged both without a conflict and
// the merged tree would not compile: every test that constructed the ports by
// hand was suddenly missing a required property. Each branch was green alone.
//
// So the ports are built in exactly one place. A story that adds a port adds
// one line below, the return type makes the compiler insist on it, and no test
// file changes at all.
//
// It lives under `src/__mocks__/` rather than beside the tests because
// `src/arch.test.ts` sweeps every other non-test module in `src/` and asserts
// that nothing outside `src/main.ts` constructs an adapter (AC-ARCH-01.1). This
// module constructs three, which is what a composition root for a test is. The
// sweep skips this directory, and that is the whole reason for the location.
import type { App } from "obsidian";
import { ObsidianCompanionPluginAdapter } from "../adapters/obsidianCompanionPluginAdapter";
import { ObsidianPeriodicNotesAdapter } from "../adapters/obsidianPeriodicNotesAdapter";
import { FakeVaultPort } from "../adapters/fakeVaultPort";
import type { SettingsTabPorts } from "../settings";

/**
 * The ports `CalendaricSettingsTab` needs, with `overrides` replacing whichever
 * ones the test cares about.
 *
 * The two companion adapters are the real ones, over whatever `app` the test
 * built. That is deliberate: these tests exist to check what the tab does with
 * a host that has been renamed, emptied or broken, so a fake in their place
 * would answer for the fake instead of for the host. A test that wants a
 * reading of its own passes one in.
 */
export function makeSettingsTabPorts(app: App, overrides: Partial<SettingsTabPorts> = {}): SettingsTabPorts {
	return {
		companion: new ObsidianCompanionPluginAdapter(app),
		periodicNotes: new ObsidianPeriodicNotesAdapter(app),
		desktop: { openPluginFile: () => undefined },
		vault: new FakeVaultPort(),
		...overrides,
	};
}
