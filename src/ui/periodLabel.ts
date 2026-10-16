import type { ReleaseGranularity } from "../types";
import { releaseFacts } from "../granularity/registry";
import { periodStart, stripDays } from "./dayStrip";

/** Read off `window.moment` rather than imported, like main.ts: the bundle carries no moment of its own. */
type Moment = ReturnType<typeof window.moment>;

/**
 * The period a note belongs to, in words, measured from `now`: Today, Last
 * week, 3 months ago. Adjacent periods get a name; farther ones a count.
 */
export function humanizePeriod(granularity: ReleaseGranularity, date: Moment, now: Moment, weekFormat = ""): string {
	// Both ends start a period of the same length, so diff in "week" is exact for an ISO week too.
	const offset = periodStart(date, granularity, weekFormat).diff(periodStart(now, granularity, weekFormat), granularity);

	const { unitName, countKey, nearNames } = releaseFacts(granularity);
	if (nearNames) {
		const near = nearNames[offset];
		if (near !== undefined) return near;
	} else {
		if (offset === 0) return `This ${unitName}`;
		if (offset === -1) return `Last ${unitName}`;
		if (offset === 1) return `Next ${unitName}`;
	}

	const locale = date.localeData();
	const count = Math.abs(offset);
	return locale.pastFuture(offset, locale.relativeTime(count, false, countKey, offset > 0));
}

export interface LabelledFile {
	granularity: ReleaseGranularity;
	date: Moment;
	/** The filename only starts with what the format writes (AC-FMT-04.3). */
	prefixMatch: boolean;
}

/** One open markdown pane: the file it shows, and the view element the label is drawn into. */
export interface LabelLeaf {
	file: { path: string } | null;
	contentEl: HTMLElement;
}

export interface PeriodLabelHost {
	leaves(): LabelLeaf[];
	enabled(): boolean;
	/** Null for a file that is not a periodic note. */
	resolve(path: string): LabelledFile | null;
	now(): Moment;
	weekFormat(): string;
	/** The configured first day of the week, as moment's `day()` number. */
	weekStart(): number;
	/** Open that day's note in the active pane, writing it first when the vault holds none. */
	openDay(date: Moment): Promise<void>;
}

/** One drawn label. The toggle outlives every redraw, so keyboard focus stays on it. */
interface DrawnLabel {
	label: HTMLElement;
	toggle: HTMLElement;
	file: LabelledFile;
	strip: HTMLElement | null;
}

/**
 * One period label per open periodic note, drawn into the pane's view element
 * beside the editor, never into the file (AC-CAL-13.2).
 *
 * `sync` is the whole lifecycle: it reads the open panes afresh, so a setting
 * change, a pane switching files and a pane closing are all the same call.
 */
export class PeriodLabels {
	/** Keyed by the pane's view element, which lives exactly as long as the pane. */
	private readonly drawn = new Map<HTMLElement, DrawnLabel>();

	constructor(private readonly host: PeriodLabelHost) {}

	sync(): void {
		const open = new Set<HTMLElement>();
		const enabled = this.host.enabled();

		for (const leaf of this.host.leaves()) {
			open.add(leaf.contentEl);
			const file = enabled && leaf.file ? this.host.resolve(leaf.file.path) : null;
			if (file) this.draw(leaf.contentEl, file);
			else this.remove(leaf.contentEl);
		}

		for (const contentEl of this.drawn.keys()) {
			if (!open.has(contentEl)) this.remove(contentEl);
		}
	}

	destroy(): void {
		for (const contentEl of [...this.drawn.keys()]) this.remove(contentEl);
	}

	private draw(contentEl: HTMLElement, file: LabelledFile): void {
		let drawn = this.drawn.get(contentEl);
		if (!drawn) {
			const label = contentEl.createDiv({ cls: "calendaric-period-label" });
			const toggle = label.createSpan({
				cls: "calendaric-day-strip-toggle",
				attr: { role: "button", tabindex: "0", "aria-expanded": "false" },
			});
			drawn = { label, toggle, file, strip: null };
			const entry = drawn;
			toggle.addEventListener("click", () => this.toggleStrip(entry));
			toggle.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				// Space would otherwise scroll the pane.
				event.preventDefault();
				this.toggleStrip(entry);
			});
			this.drawn.set(contentEl, drawn);
		}

		drawn.file = file;
		const { toggle } = drawn;
		toggle.empty();
		toggle.createSpan({ text: humanizePeriod(file.granularity, file.date, this.host.now(), this.host.weekFormat()) });
		if (file.prefixMatch) {
			toggle.createSpan({
				cls: "calendaric-period-label-inexact",
				text: "≈",
				attr: { "aria-label": "Inexact match: the filename only starts with this period's format" },
			});
		}
		if (drawn.strip) this.drawStrip(drawn);
	}

	private toggleStrip(drawn: DrawnLabel): void {
		if (drawn.strip) {
			drawn.strip.remove();
			drawn.strip = null;
		} else {
			this.drawStrip(drawn);
		}
		drawn.toggle.setAttr("aria-expanded", drawn.strip !== null);
	}

	private drawStrip(drawn: DrawnLabel): void {
		drawn.strip?.remove();
		const strip = drawn.label.createDiv({ cls: "calendaric-day-strip" });
		drawn.strip = strip;

		const { granularity, date } = drawn.file;
		for (const day of stripDays(granularity, date, this.host.weekFormat(), this.host.weekStart(), this.host.now())) {
			const button = strip.createEl("button", {
				cls: "calendaric-day-strip-day",
				text: day.date.format("dd D"),
				attr: { "data-date": day.date.format("YYYY-MM-DD"), "aria-label": day.date.format("dddd, LL") },
			});
			button.toggleClass("is-note-day", day.isNoteDay);
			button.toggleClass("is-today", day.isToday);
			button.addEventListener("click", () => void this.host.openDay(day.date));
		}
	}

	private remove(contentEl: HTMLElement): void {
		this.drawn.get(contentEl)?.label.remove();
		this.drawn.delete(contentEl);
	}
}
