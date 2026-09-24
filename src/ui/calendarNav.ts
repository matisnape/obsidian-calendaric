import type { Moment } from "moment";

/**
 * Which month the grid shows, and what the three navigation controls do to it.
 *
 * The decisions live here rather than in the DOM handlers in `calendar.ts` for
 * the reason `cellActions.ts` states: a running Obsidian is the only place the
 * controls exist. The month a step lands on, the year a December step crosses,
 * and the one case where the 'return to today' control must do nothing at all
 * are all settled against this object instead.
 *
 * The displayed date is kept at the first of its month. Nothing downstream
 * reads the day — `getMonthGrid` takes any moment inside the month — and a
 * date of the 31st would be clamped by a step into a shorter month, which is
 * how repeated stepping drifts.
 *
 * `now` is a function, not a date: the current month is re-read on every
 * question, so a view left open across midnight still answers about today.
 */
export class MonthNavigation {
	private displayed: Moment;
	/** The current month as of the last `followClock()`, or of construction before the first one. */
	private clockMonth: Moment;

	constructor(
		private readonly now: () => Moment,
		private readonly onChange: () => void,
	) {
		this.displayed = now().startOf("month");
		this.clockMonth = this.displayed.clone();
	}

	/**
	 * The minute tick: carries the grid into a new month when the clock crosses
	 * into one (AC-CAL-11.2), unless the user is looking at another month
	 * (AC-CAL-11.3). "Another month" is the displayed month against the current
	 * month at the previous tick, not a record of which controls were pressed:
	 * a user who stepped away and back is on today's month, and follows it.
	 * Asks for no re-render; the tick re-renders anyway.
	 */
	followClock(): void {
		const current = this.now().startOf("month");
		if (this.displayed.isSame(this.clockMonth, "month")) this.displayed = current.clone();
		this.clockMonth = current;
	}

	/** The month the grid draws. A copy: a caller cannot move the grid by mutating it. */
	get month(): Moment {
		return this.displayed.clone();
	}

	/** Whether the grid already shows the current month, which is what the 'today' control renders its state from. */
	get atCurrentMonth(): boolean {
		return this.displayed.isSame(this.now(), "month");
	}

	next(): void {
		this.moveTo(this.displayed.clone().add(1, "month"));
	}

	prev(): void {
		this.moveTo(this.displayed.clone().subtract(1, "month"));
	}

	/** Returns to the current month. Inert while the grid already shows it. */
	toToday(): void {
		if (this.atCurrentMonth) return;
		this.moveTo(this.now());
	}

	show(date: Moment): void {
		this.moveTo(date.clone());
	}

	private moveTo(month: Moment): void {
		this.displayed = month.startOf("month");
		this.onChange();
	}
}
