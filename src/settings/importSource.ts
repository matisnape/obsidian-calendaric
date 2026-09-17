import type {
	CompanionPluginPort,
	CompanionPluginRead,
	DailyNotesPluginState,
	PeriodicNotesPort,
} from "../adapters/companionPluginPort";
import type { Granularity } from "../types";
import { GRANULARITIES } from "./model";

/**
 * Which predecessor plugin's configuration governs one granularity.
 *
 * Naming the source is the whole answer: reading the values out of it, and
 * writing any of them into Calendaric's own settings, belong to the import
 * (US-MIG-04, US-MIG-06). Keeping the two apart is what lets the precedence be
 * checked without a vault.
 */
export type ImportSource =
	| { source: "periodic-notes" }
	| { source: "daily-notes" }
	/** Nothing to import, and `reason` says which plugin was looked at and why not. */
	| { source: "none"; reason: string };

/** What the core Daily Notes half of the resolution needs, and nothing else. */
type DailyNotesReader = Pick<CompanionPluginPort, "readDailyNotes">;

/**
 * The names, and not the values behind them. Narrowed so that widening the
 * Periodic Notes port with a second read (US-MIG-04) cannot make this
 * resolution look like it consults a calendar set's folders, which it does not.
 */
type PeriodicNotesReader = Pick<PeriodicNotesPort, "readActiveGranularities">;

/**
 * Which plugin's settings each granularity should be imported from.
 *
 * The precedence is the one the predecessor plugins had between them, and it is
 * kept because changing it would import settings the vault was not using:
 *
 * 1. Periodic Notes, for every granularity its active calendar set enables --
 *    whatever the core Daily Notes plugin says (AC-MIG-05.1).
 * 2. The core Daily Notes plugin, for `day` alone, while it is enabled
 *    (AC-MIG-05.2). No other granularity falls back to it, because it configures
 *    no other granularity.
 * 3. Otherwise nothing, said plainly rather than thrown (AC-MIG-05.3).
 *
 * Both plugins are read once here rather than once per granularity, and one loop
 * over the one granularity list answers for all of them (AC-MIG-05.5): a per
 * granularity implementation is how day and week drifted apart in the plugins
 * this one replaces.
 */
export function resolveImportSources(
	periodicNotes: PeriodicNotesReader,
	dailyNotes: DailyNotesReader,
): Record<Granularity, ImportSource> {
	const active = periodicNotes.readActiveGranularities();
	const daily = dailyNotes.readDailyNotes();

	return Object.fromEntries(
		GRANULARITIES.map((granularity) => [granularity, resolveOne(granularity, active, daily)]),
	) as Record<Granularity, ImportSource>;
}

function resolveOne(
	granularity: Granularity,
	active: CompanionPluginRead<readonly string[]>,
	daily: CompanionPluginRead<DailyNotesPluginState>,
): ImportSource {
	// AC-MIG-05.4: a read that failed is not a read that said "off". Either way
	// Periodic Notes governs nothing here -- the alternative is guessing from an
	// object that does not reflect the plugin's real state -- but the reason
	// below still has to tell the two apart for the user.
	if (active.ok && active.value.includes(granularity)) {
		return { source: "periodic-notes" };
	}

	// AC-MIG-05.2: the core plugin configures day and only day.
	if (granularity === "day" && daily.ok && daily.value.enabled) {
		return { source: "daily-notes" };
	}

	return { source: "none", reason: describeNothing(granularity, active, daily) };
}

/** Why nothing governs this granularity, naming each plugin that was looked at. */
function describeNothing(
	granularity: Granularity,
	active: CompanionPluginRead<readonly string[]>,
	daily: CompanionPluginRead<DailyNotesPluginState>,
): string {
	const periodic = active.ok
		? `The Periodic Notes plugin's active calendar set does not enable ${granularity}.`
		: active.problem;

	// Only day has a second plugin to report on.
	if (granularity !== "day") return periodic;

	const core = daily.ok ? "The core Daily Notes plugin is disabled." : daily.problem;
	return `${periodic} ${core}`;
}
