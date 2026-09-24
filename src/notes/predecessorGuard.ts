import type {
	CalendarPluginPort,
	CompanionPluginAction,
	CompanionPluginPort,
	PeriodicNotesPort,
} from "../adapters/companionPluginPort";
import { RELEASE_GRANULARITIES } from "../types";
import type { ReleaseGranularity } from "../types";

/**
 * Keeps Calendaric from writing a note another plugin also writes (US-MIG-06).
 *
 * Three plugins came before this one, and each can still create periodic
 * notes while it is on: core Daily Notes the daily one, the Calendar plugin
 * the weekly one once its week numbers are on, and Periodic Notes whatever its
 * active calendar set enables. Two plugins writing the same note race each
 * other with different templates, so a granularity one of them still owns is
 * left to it, and the user is told which plugin that is.
 *
 * Every question is asked of the plugin at the moment it matters, never
 * remembered. That is what makes AC-MIG-06.5 and AC-MIG-06.6 one rule: after
 * the user hands a granularity over, the next note waits for the plugin itself
 * to report the granularity off, whatever the write said.
 */

export type Predecessor = "daily-notes" | "calendar" | "periodic-notes";

/** In the order a granularity owned by two of them names its owner. */
const PREDECESSORS: readonly Predecessor[] = ["daily-notes", "calendar", "periodic-notes"];

const PREDECESSOR_NAME: Record<Predecessor, string> = {
	"daily-notes": "The core Daily Notes plugin",
	calendar: "The Calendar plugin",
	"periodic-notes": "The Periodic Notes plugin",
};

const LABEL: Record<ReleaseGranularity, string> = {
	day: "daily",
	week: "weekly",
	month: "monthly",
	year: "yearly",
};

export interface PredecessorPorts {
	companion: Pick<CompanionPluginPort, "readDailyNotes" | "disableDailyNotes">;
	calendar: CalendarPluginPort;
	periodicNotes: Pick<PeriodicNotesPort, "readActiveGranularities" | "disableGranularity">;
}

/** A button on a notice, and what it does when pressed. */
export interface NoticeAction {
	label: string;
	run: () => Promise<void>;
}

export type Notify = (message: string, action?: NoticeAction) => void;

export class PredecessorGuard {
	constructor(
		private ports: PredecessorPorts,
		/** Whether Calendaric itself has the granularity on, read live from its settings. */
		private calendaricEnables: (granularity: ReleaseGranularity) => boolean,
		private notify: Notify,
	) {}

	/** The predecessor that owns a granularity Calendaric also has on, or null. */
	owner(granularity: ReleaseGranularity): Predecessor | null {
		if (!this.calendaricEnables(granularity)) return null;
		return PREDECESSORS.find((predecessor) => this.owns(predecessor, granularity)) ?? null;
	}

	/**
	 * True when the note must not be written. The user has already been told
	 * why, with the offer to hand the granularity over, so the caller does
	 * nothing more.
	 */
	refuse(granularity: ReleaseGranularity): boolean {
		const predecessor = this.owner(granularity);
		if (!predecessor) return false;

		this.notify(
			`Calendaric: ${PREDECESSOR_NAME[predecessor]} still manages ${LABEL[granularity]} notes, so Calendaric did not create this one.`,
			this.handOver(predecessor, [granularity]),
		);
		return true;
	}

	/** The startup check: one notice per predecessor that overlaps Calendaric, none otherwise (AC-MIG-06.2). */
	announce(): void {
		const owned = new Map<Predecessor, ReleaseGranularity[]>();
		for (const granularity of RELEASE_GRANULARITIES) {
			const predecessor = this.owner(granularity);
			if (predecessor) owned.set(predecessor, [...(owned.get(predecessor) ?? []), granularity]);
		}

		for (const [predecessor, granularities] of owned) {
			this.notify(
				`Calendaric: ${PREDECESSOR_NAME[predecessor]} still manages ${labels(granularities)} notes. Calendaric will not create them while it does.`,
				this.handOver(predecessor, granularities),
			);
		}
	}

	private handOver(predecessor: Predecessor, granularities: ReleaseGranularity[]): NoticeAction {
		return { label: "Use Calendaric", run: () => this.release(predecessor, granularities) };
	}

	/**
	 * AC-MIG-06.5: turns each granularity off in the predecessor's own
	 * configuration, then asks the plugin again. Only its answer decides what
	 * the user is told; a write that reported success but did not take leaves
	 * the refusal in place (AC-MIG-06.6).
	 */
	private async release(predecessor: Predecessor, granularities: ReleaseGranularity[]): Promise<void> {
		for (const granularity of granularities) {
			const result = await this.turnOff(predecessor, granularity);
			if (!result.ok) this.notify(`Calendaric could not change ${PREDECESSOR_NAME[predecessor]}: ${result.problem}`);
		}

		const still = granularities.filter((granularity) => this.owns(predecessor, granularity));
		if (still.length > 0) {
			this.notify(
				`Calendaric: ${PREDECESSOR_NAME[predecessor]} still has ${labels(still)} notes on, so Calendaric keeps leaving them alone.`,
			);
			return;
		}
		this.notify(`Calendaric now manages ${labels(granularities)} notes.`);
	}

	/** AC-MIG-06.4: anything short of a clear "on" -- absent, unreadable, a throw -- is "not enabled". */
	private owns(predecessor: Predecessor, granularity: ReleaseGranularity): boolean {
		try {
			switch (predecessor) {
				case "daily-notes": {
					if (granularity !== "day") return false;
					const read = this.ports.companion.readDailyNotes();
					return read.ok && read.value.enabled;
				}
				case "calendar": {
					if (granularity !== "week") return false;
					const read = this.ports.calendar.readCalendarWeeklyNotes();
					return read.ok && read.value;
				}
				case "periodic-notes": {
					const read = this.ports.periodicNotes.readActiveGranularities();
					return read.ok && read.value.includes(granularity);
				}
			}
		} catch {
			return false;
		}
	}

	private async turnOff(predecessor: Predecessor, granularity: ReleaseGranularity): Promise<CompanionPluginAction> {
		try {
			switch (predecessor) {
				// Daily Notes has the day and nothing else, so the plugin itself goes off.
				case "daily-notes":
					return this.ports.companion.disableDailyNotes();
				case "calendar":
					return await this.ports.calendar.disableCalendarWeeklyNotes();
				case "periodic-notes":
					return this.ports.periodicNotes.disableGranularity(granularity);
			}
		} catch (error) {
			return { ok: false, problem: error instanceof Error ? error.message : String(error) };
		}
	}
}

function labels(granularities: readonly ReleaseGranularity[]): string {
	return granularities.map((granularity) => LABEL[granularity]).join(" and ");
}

/**
 * The guard for each vault, for the call sites that are handed ports rather
 * than the plugin.
 *
 * The calendar grid reaches `openOrCreateNote` with the pane's `CalendarDeps`
 * and nothing else, so the guard is found through the vault those ports wrap
 * -- the same key `cellActions.ts` already queues note writes by. Weak, so an
 * unloaded plugin's vault takes its guard with it.
 */
const guards = new WeakMap<object, PredecessorGuard>();

/** Registers (or, with null, removes) the guard for a vault. */
export function guardCreation(backingVault: object, guard: PredecessorGuard | null): void {
	if (guard) guards.set(backingVault, guard);
	else guards.delete(backingVault);
}

/** True when the note must not be written; see `PredecessorGuard.refuse`. No guard, no refusal. */
export function creationRefused(vault: { readonly backingVault: object }, granularity: ReleaseGranularity): boolean {
	return guards.get(vault.backingVault)?.refuse(granularity) ?? false;
}
