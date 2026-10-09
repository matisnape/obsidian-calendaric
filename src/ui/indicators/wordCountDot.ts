import type { CalendarIndicator } from "../../indicatorContract";
import { DEFAULT_WORDS_PER_SEGMENT, WORD_DOT_SEGMENTS, wordCountSegments } from "../calendarDots";

/**
 * The word-count dot: a 6×6 pie of five wedges, the first `filled` of them,
 * clockwise from the top, marked `is-filled`.
 */
function makeWordDotSvg(filled: number): SVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", "calendaric-dot calendaric-dot--words");
	svg.setAttribute("viewBox", "0 0 6 6");
	const point = (i: number) => {
		const angle = -Math.PI / 2 + (i * 2 * Math.PI) / WORD_DOT_SEGMENTS;
		return `${(3 + 3 * Math.cos(angle)).toFixed(3)} ${(3 + 3 * Math.sin(angle)).toFixed(3)}`;
	};
	for (let i = 0; i < WORD_DOT_SEGMENTS; i++) {
		const wedge = document.createElementNS("http://www.w3.org/2000/svg", "path");
		wedge.setAttribute("d", `M3 3 L${point(i)} A3 3 0 0 1 ${point(i + 1)} Z`);
		wedge.setAttribute("class", i < filled ? "calendaric-dot-segment is-filled" : "calendaric-dot-segment");
		svg.appendChild(wedge);
	}
	return svg;
}

/**
 * The word-count dot of every cell whose note has words (AC-CAL-07.2). It
 * arrives after the note-exists dot because reading a note is async.
 */
export const wordCountDotIndicator: CalendarIndicator = {
	apiVersion: 1,
	id: "word-count-dot",
	async draw(cells, context) {
		const slots = cells.filter((cell) => cell.noteExists);
		const counts = await context.getWordCounts(slots.map((cell) => cell.path));
		for (const cell of slots) {
			// ponytail: threshold is the default until a setting carries one
			const filled = wordCountSegments(counts.get(cell.path) ?? 0, DEFAULT_WORDS_PER_SEGMENT);
			if (filled > 0) cell.container.appendChild(makeWordDotSvg(filled));
		}
	},
};
