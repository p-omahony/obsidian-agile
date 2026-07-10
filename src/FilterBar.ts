/** The board/timeline filter bar: active-filter chips plus a value-selection
 * popover. Self-contained UI; it reads and mutates a BoardFilters object owned by
 * the host view (via the injected accessor) and asks the host to persist + re-render
 * through `commit`. The popover is attached to document.body so it survives the
 * host's full re-render, keeping multi-select fluid. */

import { Menu } from "obsidian";
import type { BoardConfig } from "./settings";
import {
	baseValues,
	CATEGORICAL_FILTERS,
	DATE_FILTERS,
	distinctValues,
	fieldActive,
	FILTER_EMPTY,
	FILTER_EMPTY_LABEL,
	FILTER_LABELS,
	isFilterActive,
} from "./filters";
import type { BoardFilters, CategoricalFilter, DateFilter } from "./filters";
import type { Task } from "./types";

/** Everything the filter bar needs from its host, as narrow callbacks. */
export interface FilterBarDeps {
	/** Returns the live, mutable filters object owned by the host. */
	getFilters: () => BoardFilters;
	/** Persists the current filters in the view state and re-renders both views. */
	commit: () => void;
	/** Clears all filters (host reassigns its own reference, then commits). */
	reset: () => void;
}

export class FilterBar {
	/** The open value-selection popover, if any (attached to document.body). */
	private popover: { el: HTMLElement; cleanup: () => void } | null = null;

	constructor(private deps: FilterBarDeps) {}

	/** Bar of active-filter chips + a "+ Filtre" affordance, below the toolbar. */
	render(root: HTMLElement, board: BoardConfig, allTasks: Task[]): void {
		const filters = this.deps.getFilters();
		const bar = root.createDiv({ cls: "agile-filter-bar" });

		bar.createSpan({ cls: "agile-filter-label", text: "Filtres :" });

		for (const field of [...CATEGORICAL_FILTERS, ...DATE_FILTERS]) {
			if (fieldActive(filters, field)) {
				this.renderChip(bar, board, field, allTasks);
			}
		}

		const add = bar.createSpan({ cls: "agile-filter-add", text: "+ Filtre" });
		add.addEventListener("click", (e) => this.openAddMenu(e, board, allTasks));

		if (isFilterActive(filters)) {
			const clear = bar.createSpan({ cls: "agile-filter-clear", text: "Effacer" });
			clear.addEventListener("click", () => this.clearAll());
		}
	}

	/** Removes the open popover and its document listeners, if any. */
	closePopover(): void {
		if (!this.popover) return;
		this.popover.cleanup();
		this.popover.el.remove();
		this.popover = null;
	}

	/** One chip summarizing an active filter; body opens its editor, ✕ clears it. */
	private renderChip(
		bar: HTMLElement,
		board: BoardConfig,
		field: CategoricalFilter | DateFilter,
		allTasks: Task[]
	): void {
		const chip = bar.createSpan({ cls: "agile-filter-chip" });
		const body = chip.createSpan({ cls: "agile-filter-chip-body" });
		body.createSpan({ cls: "agile-filter-chip-name", text: FILTER_LABELS[field] });
		body.createSpan({ cls: "agile-filter-chip-value", text: this.summary(field) });
		body.addEventListener("click", () => this.openPopover(body, board, field, allTasks));

		const del = chip.createSpan({ cls: "agile-filter-chip-remove", text: "✕" });
		del.setAttribute("aria-label", `Effacer le filtre ${FILTER_LABELS[field]}`);
		del.addEventListener("click", (e) => {
			e.stopPropagation();
			delete this.deps.getFilters()[field];
			this.deps.commit();
		});
	}

	/** Short text describing the current selection for a chip. */
	private summary(field: CategoricalFilter | DateFilter): string {
		const filters = this.deps.getFilters();
		if (field === "start" || field === "due") {
			const range = filters[field];
			if (!range) return "";
			if (range.from && range.to) return `${range.from} → ${range.to}`;
			if (range.from) return `≥ ${range.from}`;
			if (range.to) return `≤ ${range.to}`;
			return "";
		}
		const values = filters[field] ?? [];
		return values.map((v) => (v === FILTER_EMPTY ? FILTER_EMPTY_LABEL : v)).join(", ");
	}

	/** Menu to add a filter on a property not yet active. */
	private openAddMenu(evt: MouseEvent, board: BoardConfig, allTasks: Task[]): void {
		const filters = this.deps.getFilters();
		const menu = new Menu();
		let any = false;
		for (const field of [...CATEGORICAL_FILTERS, ...DATE_FILTERS]) {
			if (fieldActive(filters, field)) continue;
			any = true;
			menu.addItem((item) =>
				item.setTitle(FILTER_LABELS[field]).onClick(() => {
					// Anchor the popover on the "+ Filtre" affordance itself.
					const anchor = evt.target as HTMLElement;
					this.openPopover(anchor, board, field, allTasks);
				})
			);
		}
		if (!any) {
			menu.addItem((item) => item.setTitle("Tous les filtres sont actifs").setDisabled(true));
		}
		menu.showAtMouseEvent(evt);
	}

	/** Opens the value-selection popover for a field, attached to document.body. */
	private openPopover(
		anchor: HTMLElement,
		board: BoardConfig,
		field: CategoricalFilter | DateFilter,
		allTasks: Task[]
	): void {
		this.closePopover();

		const el = document.body.createDiv({ cls: "agile-filter-popover" });
		el.createDiv({ cls: "agile-filter-popover-header", text: FILTER_LABELS[field] });

		if (field === "start" || field === "due") {
			this.buildDatePopover(el, field);
		} else {
			this.buildValuePopover(el, board, field, allTasks);
		}

		// Position under the anchor, kept within the viewport.
		const rect = anchor.getBoundingClientRect();
		el.style.top = `${rect.bottom + 4}px`;
		el.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;

		// Close on outside mousedown / Escape. mousedown avoids self-closing on the
		// click that opened it; the popover survives render() since it lives on body.
		const onDocClick = (e: MouseEvent) => {
			if (!el.contains(e.target as Node)) this.closePopover();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") this.closePopover();
		};
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		this.popover = {
			el,
			cleanup: () => {
				document.removeEventListener("mousedown", onDocClick);
				document.removeEventListener("keydown", onKey);
			},
		};
	}

	/** Checkbox list for a categorical filter. */
	private buildValuePopover(
		el: HTMLElement,
		board: BoardConfig,
		field: CategoricalFilter,
		allTasks: Task[]
	): void {
		const values = distinctValues(allTasks, field, baseValues(field, board.statuses));
		if (values.length === 0) {
			el.createDiv({ cls: "agile-filter-empty", text: "Aucune valeur" });
			return;
		}
		for (const value of values) {
			const row = el.createDiv({ cls: "agile-filter-option" });
			const cb = row.createEl("input");
			cb.type = "checkbox";
			cb.checked = (this.deps.getFilters()[field] ?? []).includes(value);
			row.createSpan({ text: value === FILTER_EMPTY ? FILTER_EMPTY_LABEL : value });
			const toggle = () => this.toggleValue(field, value, cb.checked);
			cb.addEventListener("change", toggle);
			row.addEventListener("click", (e) => {
				if (e.target !== cb) {
					cb.checked = !cb.checked;
					toggle();
				}
			});
		}
	}

	/** Adds/removes a value from a categorical filter, then re-renders live. */
	private toggleValue(field: CategoricalFilter, value: string, on: boolean): void {
		const filters = this.deps.getFilters();
		const current = new Set(filters[field] ?? []);
		if (on) current.add(value);
		else current.delete(value);
		if (current.size > 0) filters[field] = [...current];
		else delete filters[field];
		this.deps.commit();
	}

	/** Two date inputs (from / to) for a date-range filter. */
	private buildDatePopover(el: HTMLElement, field: DateFilter): void {
		const range = this.deps.getFilters()[field] ?? {};
		const wrap = el.createDiv({ cls: "agile-filter-dates" });

		const mkInput = (label: string, bound: "from" | "to"): void => {
			const row = wrap.createDiv({ cls: "agile-filter-date-row" });
			row.createSpan({ text: label });
			const input = row.createEl("input");
			input.type = "date";
			input.value = range[bound] ?? "";
			input.addEventListener("change", () => this.setDateBound(field, bound, input.value));
		};
		mkInput("De", "from");
		mkInput("À", "to");
	}

	/** Sets one bound of a date filter, clearing the filter when both are empty. */
	private setDateBound(field: DateFilter, bound: "from" | "to", value: string): void {
		const filters = this.deps.getFilters();
		const range = { ...(filters[field] ?? {}) };
		if (value) range[bound] = value;
		else delete range[bound];
		if (range.from || range.to) filters[field] = range;
		else delete filters[field];
		this.deps.commit();
	}

	/** Clears every filter (delegated to the host, which owns the reference). */
	private clearAll(): void {
		this.deps.reset();
	}
}
