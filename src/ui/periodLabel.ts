import type { ReleaseGranularity } from "../types";
import { computeNoteDate } from "../fmt/noteDate";

/** Read off `window.moment` rather than imported, like main.ts: the bundle carries no moment of its own. */
type Moment = ReturnType<typeof window.moment>;

const UNIT_NAMES: Record<ReleaseGranularity, string> = { day: "day", week: "week", month: "month", year: "year" };

/** moment's own relative-time keys, so a count reads the way the locale writes it. */
const COUNT_KEYS = { day: "dd", week: "ww", month: "MM", year: "yy" } as const;

/**
 * The start of the period `date` falls in, read off the note identity itself
 * (`granularity:<epoch ms>`), so a week starts wherever the index says it does.
 */
function periodStart(date: Moment, granularity: ReleaseGranularity, weekFormat: string): Moment {
	return window.moment(Number(computeNoteDate(date, granularity, weekFormat).split(":")[1]));
}

/**
 * The period a note belongs to, in words, measured from `now`: Today, Last
 * week, 3 months ago. Adjacent periods get a name; farther ones a count.
 */
export function humanizePeriod(granularity: ReleaseGranularity, date: Moment, now: Moment, weekFormat = ""): string {
	// Both ends start a period of the same length, so diff in "week" is exact for an ISO week too.
	const offset = periodStart(date, granularity, weekFormat).diff(periodStart(now, granularity, weekFormat), granularity);

	if (granularity === "day") {
		if (offset === 0) return "Today";
		if (offset === -1) return "Yesterday";
		if (offset === 1) return "Tomorrow";
	} else {
		const unit = UNIT_NAMES[granularity];
		if (offset === 0) return `This ${unit}`;
		if (offset === -1) return `Last ${unit}`;
		if (offset === 1) return `Next ${unit}`;
	}

	const locale = date.localeData();
	const count = Math.abs(offset);
	return locale.pastFuture(offset, locale.relativeTime(count, false, COUNT_KEYS[granularity], offset > 0));
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
	private readonly drawn = new Map<HTMLElement, HTMLElement>();

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
		let label = this.drawn.get(contentEl);
		if (!label) {
			label = contentEl.createDiv({ cls: "calendaric-period-label" });
			this.drawn.set(contentEl, label);
		}

		label.empty();
		label.createSpan({ text: humanizePeriod(file.granularity, file.date, this.host.now(), this.host.weekFormat()) });
		if (file.prefixMatch) {
			label.createSpan({
				cls: "calendaric-period-label-inexact",
				text: "≈",
				attr: { "aria-label": "Inexact match: the filename only starts with this period's format" },
			});
		}
	}

	private remove(contentEl: HTMLElement): void {
		this.drawn.get(contentEl)?.remove();
		this.drawn.delete(contentEl);
	}
}
