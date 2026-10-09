import type { CalendarIndicator } from "../../indicatorContract";

/** Creates the same SVG dot used by the Calendar plugin (6×6 viewBox, circle r=2). */
function makeDotSvg(): SVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", "calendaric-dot calendaric-dot--exists");
	svg.setAttribute("viewBox", "0 0 6 6");
	const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
	circle.setAttribute("cx", "3");
	circle.setAttribute("cy", "3");
	circle.setAttribute("r", "2");
	svg.appendChild(circle);
	return svg;
}

export const noteDotIndicator: CalendarIndicator = {
	apiVersion: 1,
	id: "note-dot",
	draw(cells) {
		for (const cell of cells) if (cell.noteExists) cell.container.appendChild(makeDotSvg());
	},
};
