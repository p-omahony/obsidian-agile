/** Automatic Gantt-style timeline: tasks positioned by their start/due dates,
 * grouped into epic lanes. Read-only — clicking a task opens the edit modal. */

import type { BoardConfig, TimelineScale } from "./settings";
import { applyBadgeColor } from "./colors";
import type { Task } from "./types";

/** Lane key for tasks without an epic. */
const NO_EPIC = "No epic";

/** Horizontal density (pixels per calendar day) for each axis scale. */
const PX_PER_DAY: Record<TimelineScale, number> = { day: 34, week: 14, month: 5 };

const LANE_HEIGHT = 40;

/** Parses a `YYYY-MM-DD` frontmatter value into a local, time-stripped Date. */
function parseDate(value?: string): Date | null {
	if (!value) return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
	if (!m) return null;
	const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const d = new Date(year, month - 1, day);
	// Reject out-of-range parts (e.g. 2026-13-01, 2026-02-31) that Date would
	// otherwise silently roll over into a neighbouring month/year.
	if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
		return null;
	}
	return d;
}

/** Whole-day distance from `a` to `b` (DST-safe via rounding). */
function dayDiff(a: Date, b: Date): number {
	return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function addDays(d: Date, n: number): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Monday of the week containing `d`. */
function startOfWeek(d: Date): Date {
	const offset = (d.getDay() + 6) % 7; // 0 = Monday
	return addDays(d, -offset);
}

/** Rounds `date` down to the start of its scale bucket. */
function alignStart(date: Date, scale: TimelineScale): Date {
	if (scale === "week") return startOfWeek(date);
	if (scale === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
	return date;
}

/** Rounds `date` up to the exclusive end of its scale bucket. */
function alignEnd(date: Date, scale: TimelineScale): Date {
	if (scale === "week") return addDays(startOfWeek(date), 7);
	if (scale === "month") return new Date(date.getFullYear(), date.getMonth() + 1, 1);
	return addDays(date, 1);
}

/** Advances a tick cursor by one scale bucket. */
function nextTick(cursor: Date, scale: TimelineScale): Date {
	if (scale === "week") return addDays(cursor, 7);
	if (scale === "month") return new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
	return addDays(cursor, 1);
}

function tickLabel(date: Date, scale: TimelineScale, isFirst: boolean): string {
	const month = date.toLocaleDateString(undefined, { month: "short" });
	if (scale === "month") return `${month} ${date.getFullYear()}`;
	if (scale === "week") return `${month} ${date.getDate()}`;
	// Day scale: repeat the month on the 1st (and on the first tick) for context.
	return date.getDate() === 1 || isFirst ? `${month} ${date.getDate()}` : String(date.getDate());
}

/** A task placed on the timeline: a bar (start→due) or a single-date milestone. */
interface Placed {
	task: Task;
	epic: string;
	start: Date; // milestone date when `bar` is false
	due: Date;
	bar: boolean;
}

/** Splits tasks into datable (with a placement) and unscheduled buckets. */
function placeTasks(tasks: Task[]): { placed: Placed[]; unscheduled: Task[] } {
	const placed: Placed[] = [];
	const unscheduled: Task[] = [];

	for (const task of tasks) {
		const start = parseDate(task.start);
		const due = parseDate(task.due);
		const epic = task.epic && task.epic.length > 0 ? task.epic : NO_EPIC;

		if (start && due) {
			// Guard against inverted ranges.
			const [a, b] = due < start ? [due, start] : [start, due];
			placed.push({ task, epic, start: a, due: b, bar: true });
		} else if (due || start) {
			const at = (due ?? start) as Date;
			placed.push({ task, epic, start: at, due: at, bar: false });
		} else {
			unscheduled.push(task);
		}
	}
	return { placed, unscheduled };
}

/** Groups placed tasks by epic, preserving encounter order with "No epic" last. */
function groupByEpic(placed: Placed[]): Map<string, Placed[]> {
	const groups = new Map<string, Placed[]>();
	for (const p of placed) {
		if (!groups.has(p.epic)) groups.set(p.epic, []);
		(groups.get(p.epic) as Placed[]).push(p);
	}
	// Move "No epic" to the end if present.
	if (groups.has(NO_EPIC)) {
		const noEpic = groups.get(NO_EPIC) as Placed[];
		groups.delete(NO_EPIC);
		groups.set(NO_EPIC, noEpic);
	}
	return groups;
}

/** Renders the timeline into `container`. */
export function renderTimeline(
	container: HTMLElement,
	tasks: Task[],
	board: BoardConfig,
	onOpenTask: (task: Task) => void
): void {
	container.addClass("agile-timeline");

	const { placed, unscheduled } = placeTasks(tasks);

	if (placed.length === 0) {
		container.createDiv({ cls: "agile-timeline-empty", text: "No dated tasks yet. Add a start or due date." });
		renderUnscheduled(container, unscheduled, onOpenTask);
		return;
	}

	const scale = board.timelineScale ?? "week";
	const pxPerDay = PX_PER_DAY[scale];

	// Time window, aligned to whole scale buckets.
	let min = placed[0].start;
	let max = placed[0].due;
	for (const p of placed) {
		if (p.start < min) min = p.start;
		if (p.due > max) max = p.due;
	}
	const rangeStart = alignStart(min, scale);
	const rangeEnd = alignEnd(max, scale);
	const totalDays = dayDiff(rangeStart, rangeEnd);
	const totalWidth = totalDays * pxPerDay;

	const groups = groupByEpic(placed);
	const epicColors = board.colors.epic ?? {};

	const layout = container.createDiv({ cls: "agile-timeline-layout" });

	// --- Left sticky column: epic labels ---
	const side = layout.createDiv({ cls: "agile-timeline-side" });
	side.createDiv({ cls: "agile-timeline-side-header" });
	for (const epic of groups.keys()) {
		const cell = side.createDiv({ cls: "agile-timeline-side-label" });
		const color = epicColors[epic];
		if (color?.bg ?? color?.text) {
			cell.createSpan({ cls: "agile-timeline-side-dot" }).style.backgroundColor =
				color.bg ?? (color.text as string);
		}
		cell.createSpan({ text: epic });
	}

	// --- Right scrollable area: axis + lanes ---
	const main = layout.createDiv({ cls: "agile-timeline-main" });

	const axis = main.createDiv({ cls: "agile-timeline-axis" });
	axis.style.width = `${totalWidth}px`;
	let cursor = rangeStart;
	let first = true;
	while (cursor < rangeEnd) {
		const left = dayDiff(rangeStart, cursor) * pxPerDay;
		const tick = axis.createDiv({ cls: "agile-timeline-tick", text: tickLabel(cursor, scale, first) });
		tick.style.left = `${left}px`;
		cursor = nextTick(cursor, scale);
		first = false;
	}

	const lanes = main.createDiv({ cls: "agile-timeline-lanes" });
	for (const [, items] of groups) {
		const lane = lanes.createDiv({ cls: "agile-timeline-lane" });
		lane.style.width = `${totalWidth}px`;
		for (const p of items) {
			renderItem(lane, p, rangeStart, pxPerDay, epicColors[p.epic], onOpenTask);
		}
	}

	renderUnscheduled(container, unscheduled, onOpenTask);
}

/** Renders a single bar or milestone inside a lane. */
function renderItem(
	lane: HTMLElement,
	p: Placed,
	rangeStart: Date,
	pxPerDay: number,
	color: { bg?: string; text?: string } | undefined,
	onOpenTask: (task: Task) => void
): void {
	const left = dayDiff(rangeStart, p.start) * pxPerDay;

	if (p.bar) {
		const width = Math.max(pxPerDay, (dayDiff(p.start, p.due) + 1) * pxPerDay);
		const bar = lane.createDiv({ cls: "agile-timeline-bar", text: p.task.title });
		bar.style.left = `${left}px`;
		bar.style.width = `${width}px`;
		if (color) applyBadgeColor(bar, color);
		bar.addEventListener("click", () => onOpenTask(p.task));
	} else {
		const wrap = lane.createDiv({ cls: "agile-timeline-milestone-wrap" });
		wrap.style.left = `${left}px`;
		const dot = wrap.createSpan({ cls: "agile-timeline-milestone" });
		if (color?.bg ?? color?.text) dot.style.backgroundColor = color.bg ?? (color.text as string);
		wrap.createSpan({ cls: "agile-timeline-milestone-label", text: p.task.title });
		wrap.addEventListener("click", () => onOpenTask(p.task));
	}
}

/** Lists tasks with no start/due date so they aren't hidden. */
function renderUnscheduled(
	container: HTMLElement,
	tasks: Task[],
	onOpenTask: (task: Task) => void
): void {
	if (tasks.length === 0) return;
	const section = container.createDiv({ cls: "agile-timeline-unscheduled" });
	section.createDiv({ cls: "agile-timeline-unscheduled-header", text: "Unscheduled" });
	const list = section.createDiv({ cls: "agile-timeline-unscheduled-list" });
	for (const task of tasks) {
		const chip = list.createSpan({ cls: "agile-timeline-unscheduled-item", text: task.title });
		chip.addEventListener("click", () => onOpenTask(task));
	}
}
