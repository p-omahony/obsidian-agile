/** Board/timeline filtering: a pure layer over the task list, independent of Obsidian.
 * Applied once in KanbanView.render(); since both the board and the timeline consume
 * the same task array, filtering it filters both views at once. */

import { parseDate } from "./timeline";
import { UNTRIAGED } from "./taskService";
import { PRIORITIES } from "./types";
import type { Task } from "./types";

/** Inclusive date range (either bound optional), values as `YYYY-MM-DD`. */
export interface DateRange {
	from?: string;
	to?: string;
}

/** Active filters over a board's tasks. Empty/absent keys mean "no constraint". */
export interface BoardFilters {
	status?: string[];
	priority?: string[];
	project?: string[];
	epic?: string[];
	assignee?: string[];
	start?: DateRange;
	due?: DateRange;
}

/** Categorical (value-set) filterable properties, in display order. */
export const CATEGORICAL_FILTERS = ["status", "priority", "project", "epic", "assignee"] as const;
export type CategoricalFilter = (typeof CATEGORICAL_FILTERS)[number];

/** Date-range filterable properties, in display order. */
export const DATE_FILTERS = ["start", "due"] as const;
export type DateFilter = (typeof DATE_FILTERS)[number];

/** Sentinel selectable option standing for "value absent". */
export const FILTER_EMPTY = "__empty__";
export const FILTER_EMPTY_LABEL = "(Aucun)";

/** Human label for a filter property. */
export const FILTER_LABELS: Record<CategoricalFilter | DateFilter, string> = {
	status: "Statut",
	priority: "Priorité",
	project: "Projet",
	epic: "Epic",
	assignee: "Assigné",
	start: "Début",
	due: "Échéance",
};

/** The value used to match a task against a categorical filter (empty → sentinel). */
function categoricalValue(task: Task, field: CategoricalFilter): string {
	if (field === "status") {
		// Status is always set (UNTRIAGED when blank); expose UNTRIAGED as the empty option.
		return task.status === UNTRIAGED ? FILTER_EMPTY : task.status;
	}
	const raw = task[field];
	return raw && raw.length > 0 ? raw : FILTER_EMPTY;
}

/** True if `date` (a task's parsed date) falls within an inclusive range. */
function inRange(date: Date, range: DateRange): boolean {
	const from = parseDate(range.from);
	const to = parseDate(range.to);
	if (from && date < from) return false;
	if (to && date > to) return false;
	return true;
}

/** Keeps only the tasks satisfying every active filter (OR within a property, AND across). */
export function applyFilters(tasks: Task[], filters: BoardFilters): Task[] {
	return tasks.filter((task) => {
		for (const field of CATEGORICAL_FILTERS) {
			const selected = filters[field];
			if (selected && selected.length > 0 && !selected.includes(categoricalValue(task, field))) {
				return false;
			}
		}
		for (const field of DATE_FILTERS) {
			const range = filters[field];
			if (range && (range.from || range.to)) {
				const date = parseDate(task[field]);
				// A dated filter excludes tasks lacking that date.
				if (!date || !inRange(date, range)) return false;
			}
		}
		return true;
	});
}

/**
 * Distinct selectable values for a categorical filter, sorted, seeded by `base`
 * (e.g. PRIORITIES or the board's statuses) so known options appear even when no
 * task uses them yet. Appends FILTER_EMPTY when at least one task has no value.
 */
export function distinctValues(tasks: Task[], field: CategoricalFilter, base: string[] = []): string[] {
	const values = new Set<string>();
	let hasEmpty = false;
	for (const task of tasks) {
		const v = categoricalValue(task, field);
		if (v === FILTER_EMPTY) hasEmpty = true;
		else values.add(v);
	}
	for (const b of base) {
		if (b !== UNTRIAGED) values.add(b);
	}
	const sorted = [...values].sort((a, b) => a.localeCompare(b));
	if (hasEmpty) sorted.push(FILTER_EMPTY);
	return sorted;
}

/** Convenience: known base values for a categorical field, given the board's statuses. */
export function baseValues(field: CategoricalFilter, statuses: string[]): string[] {
	if (field === "priority") return [...PRIORITIES];
	if (field === "status") return statuses;
	return [];
}

/** True if at least one filter is currently constraining the task list. */
export function isFilterActive(filters: BoardFilters): boolean {
	for (const field of CATEGORICAL_FILTERS) {
		if (filters[field] && (filters[field] as string[]).length > 0) return true;
	}
	for (const field of DATE_FILTERS) {
		const range = filters[field];
		if (range && (range.from || range.to)) return true;
	}
	return false;
}

/** True if a specific field has an active constraint (for chip display). */
export function fieldActive(filters: BoardFilters, field: CategoricalFilter | DateFilter): boolean {
	if (field === "start" || field === "due") {
		const range = filters[field];
		return !!(range && (range.from || range.to));
	}
	const sel = filters[field];
	return !!(sel && sel.length > 0);
}
