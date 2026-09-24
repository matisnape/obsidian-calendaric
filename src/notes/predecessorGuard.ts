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
 * Every question is asked of the plugin at the moment it matters. That is
 * what makes AC-MIG-06.5 and AC-MIG-06.6 one rule: after the user hands a
 * granularity over, the next note waits for the plugin itself to report the
 * granularity off. The one thing remembered is a hand-over whose save was not
 * confirmed: the plugin may read "off" from memory while its data.json still
 * says on, so the granularity stays with it until a hand-over does confirm.
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

/**
 * Shows a notice. A sticky one stays until dismissed; the others time out, so
 * a refusal repeated on every click does not pile up on screen.
 */
export type Notify = (message: string, action?: NoticeAction, sticky?: boolean) => void;

export class PredecessorGuard {
	/** Hand-overs that were written but not confirmed saved, and who keeps each granularity meanwhile. */
	private unconfirmed = new Map<ReleaseGranularity, Predecessor>();

	constructor(
		private ports: PredecessorPorts,
		/** Whether Calendaric itself has the granularity on, read live from its settings. */
		private calendaricEnables: (granularity: ReleaseGranularity) => boolean,
		private notify: Notify,
	) {}

	/** The predecessor that owns a granularity Calendaric also has on, or null. */
	owner(granularity: ReleaseGranularity): Predecessor | null {
		return this.owners(granularity)[0] ?? null;
	}

	/** Every predecessor that owns a granularity Calendaric also has on, first owner first. */
	private owners(granularity: ReleaseGranularity): Predecessor[] {
		if (!this.calendaricEnables(granularity)) return [];
		const live = PREDECESSORS.filter((predecessor) => this.owns(predecessor, granularity));
		const pending = this.unconfirmed.get(granularity);
		if (!pending || live.includes(pending)) return live;
		// A predecessor switched off or removed writes nothing, saved or not.
		if (!this.running(pending)) {
			this.unconfirmed.delete(granularity);
			return live;
		}
		return [...live, pending];
	}

	/**
	 * True when the note must not be written. The user has already been told
	 * why, with the offer to hand the granularity over, so the caller does
	 * nothing more. `quietly` is for a path the startup notice already
	 * explained, so the same news is not shown twice.
	 */
	refuse(granularity: ReleaseGranularity, quietly = false): boolean {
		const predecessor = this.owner(granularity);
		if (!predecessor) return false;
		if (quietly) return true;

		this.notify(
			`Calendaric: ${PREDECESSOR_NAME[predecessor]} still manages ${LABEL[granularity]} notes, so Calendaric did not create this one.`,
			this.handOver(predecessor, [granularity]),
		);
		return true;
	}

	/** The startup check: one notice per predecessor that overlaps Calendaric, none otherwise (AC-MIG-06.2). */
	announce(): void {
		for (const [predecessor, granularities] of this.overlaps(RELEASE_GRANULARITIES)) {
			this.offerHandOver(predecessor, granularities);
		}
	}

	/**
	 * Which predecessors own which of these granularities. A granularity two
	 * plugins own is listed under both, so each one's hand-over is offered.
	 */
	private overlaps(granularities: readonly ReleaseGranularity[]): Map<Predecessor, ReleaseGranularity[]> {
		const owned = new Map<Predecessor, ReleaseGranularity[]>();
		for (const granularity of granularities) {
			for (const predecessor of this.owners(granularity)) {
				owned.set(predecessor, [...(owned.get(predecessor) ?? []), granularity]);
			}
		}
		return owned;
	}

	private offerHandOver(predecessor: Predecessor, granularities: ReleaseGranularity[]): void {
		this.notify(
			`Calendaric: ${PREDECESSOR_NAME[predecessor]} still manages ${labels(granularities)} notes. Calendaric will not create them while it does.`,
			this.handOver(predecessor, granularities),
			true,
		);
	}

	private handOver(predecessor: Predecessor, granularities: ReleaseGranularity[]): NoticeAction {
		return { label: "Use Calendaric", run: () => this.release(predecessor, granularities) };
	}

	/**
	 * AC-MIG-06.5: turns each granularity off in the predecessor's own
	 * configuration, then asks every predecessor again. Only those answers
	 * decide what the user is told: a write that did not take, or was not
	 * saved, leaves the refusal in place (AC-MIG-06.6), and a granularity a
	 * second predecessor also owns is offered for that one's hand-over next.
	 */
	private async release(predecessor: Predecessor, granularities: ReleaseGranularity[]): Promise<void> {
		for (const granularity of granularities) {
			const result = await this.turnOff(predecessor, granularity);
			if (result.ok) {
				if (this.unconfirmed.get(granularity) === predecessor) this.unconfirmed.delete(granularity);
				continue;
			}
			this.unconfirmed.set(granularity, predecessor);
			this.notify(`Calendaric could not change ${PREDECESSOR_NAME[predecessor]}: ${result.problem}`);
		}

		const freed = granularities.filter((granularity) => this.owner(granularity) === null);
		if (freed.length > 0) this.notify(`Calendaric now manages ${labels(freed)} notes.`);

		for (const [owner, still] of this.overlaps(granularities)) {
			if (owner !== predecessor) {
				this.offerHandOver(owner, still);
				continue;
			}
			this.notify(
				`Calendaric: ${PREDECESSOR_NAME[predecessor]} still has ${labels(still)} notes on, so Calendaric keeps leaving them alone.`,
			);
		}
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

	/**
	 * Whether the plugin is still installed and on, whatever it reports for a
	 * granularity. A read that fails for any reason -- absent, unreadable, a
	 * throw -- is "not enabled" here too (AC-MIG-06.4).
	 */
	private running(predecessor: Predecessor): boolean {
		try {
			switch (predecessor) {
				// Daily Notes is on exactly when it owns the day.
				case "daily-notes":
					return this.owns(predecessor, "day");
				case "calendar":
					return this.ports.calendar.readCalendarWeeklyNotes().ok;
				case "periodic-notes":
					return this.ports.periodicNotes.readActiveGranularities().ok;
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
					return await this.ports.periodicNotes.disableGranularity(granularity);
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
export function creationRefused(
	vault: { readonly backingVault: object },
	granularity: ReleaseGranularity,
	quietly = false,
): boolean {
	return guards.get(vault.backingVault)?.refuse(granularity, quietly) ?? false;
}

/** The startup check for a vault; see `PredecessorGuard.announce`. */
export function announceOverlaps(vault: { readonly backingVault: object }): void {
	guards.get(vault.backingVault)?.announce();
}
