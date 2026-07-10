import { ItemView, Notice, TFile, TFolder, WorkspaceLeaf, debounce } from "obsidian";
import Sortable from "sortablejs";
import type AgilePlugin from "./main";
import type { BoardConfig } from "./settings";
import { UNTRIAGED, TaskService } from "./taskService";
import { TaskEditModal } from "./TaskEditModal";
import { renderTimeline } from "./timeline";
import { applyBadgeColor } from "./colors";
import { applyFilters, CATEGORICAL_FILTERS, DATE_FILTERS } from "./filters";
import type { BoardFilters } from "./filters";
import { beginInlineEdit } from "./inlineEdit";
import { FilterBar } from "./FilterBar";
import { Toolbar } from "./toolbar";
import type { Column, Task } from "./types";

export const VIEW_TYPE_KANBAN = "agile-kanban-view";

/** Collapsible sections shown together in the view. */
type SectionKey = "board" | "timeline";

export class KanbanView extends ItemView {
	private plugin: AgilePlugin;
	private service: TaskService | null = null;
	private sortables: Sortable[] = [];
	/** Which board this view displays (persisted in the view state). */
	boardId = "";
	/** Collapsed state of each section (persisted in the view state). */
	private collapsed: Record<SectionKey, boolean> = { board: false, timeline: false };
	/** Active board/timeline filters (persisted in the view state). */
	private filters: BoardFilters = {};
	/** Debounced re-render, reused for vault/cache events. */
	private scheduleRender = debounce(() => this.render(), 200, true);
	/** Extracted UI controllers (own their menus/popovers). */
	private toolbar: Toolbar;
	private filterBar: FilterBar;

	constructor(leaf: WorkspaceLeaf, plugin: AgilePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.toolbar = new Toolbar({
			getBoards: () => this.plugin.settings.boards,
			saveSettings: () => this.plugin.saveSettings(),
			getFolders: () => this.listFolders(),
			switchBoard: (boardId) => this.switchBoard(boardId),
			rerender: () => this.render(),
		});
		this.filterBar = new FilterBar({
			getFilters: () => this.filters,
			commit: () => this.commitFilterChange(),
			reset: () => {
				this.filters = {};
				this.commitFilterChange();
			},
		});
	}

	getViewType(): string {
		return VIEW_TYPE_KANBAN;
	}

	getDisplayText(): string {
		return this.resolveBoard()?.name ?? "Agile Kanban";
	}

	getIcon(): string {
		return "kanban-square";
	}

	getState(): Record<string, unknown> {
		return {
			...super.getState(),
			boardId: this.boardId,
			collapsed: { ...this.collapsed },
			filters: { ...this.filters },
		};
	}

	async setState(state: unknown, result: unknown): Promise<void> {
		const s = state as {
			boardId?: string;
			collapsed?: Partial<Record<SectionKey, unknown>>;
			filters?: unknown;
		} | null;
		if (typeof s?.boardId === "string") this.boardId = s.boardId;
		this.collapsed = {
			board: s?.collapsed?.board === true,
			timeline: s?.collapsed?.timeline === true,
		};
		this.filters = this.sanitizeFilters(s?.filters);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await super.setState(state as any, result as any);
		this.render();
	}

	/** Vault folder paths (excluding root), sorted — for the toolbar's folder menu. */
	private listFolders(): string[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
			.map((f) => f.path)
			.sort((a, b) => a.localeCompare(b));
	}

	/** Resolves this view's board, falling back to the first defined one. */
	private resolveBoard(): BoardConfig | undefined {
		const boards = this.plugin.settings.boards;
		return boards.find((b) => b.id === this.boardId) ?? boards[0];
	}

	/** Coerces persisted (untrusted) view state into a well-formed BoardFilters. */
	private sanitizeFilters(raw: unknown): BoardFilters {
		const src = (raw ?? {}) as Record<string, unknown>;
		const out: BoardFilters = {};
		for (const field of CATEGORICAL_FILTERS) {
			const v = src[field];
			if (Array.isArray(v)) {
				const values = v.filter((x): x is string => typeof x === "string");
				if (values.length > 0) out[field] = values;
			}
		}
		for (const field of DATE_FILTERS) {
			const v = src[field] as { from?: unknown; to?: unknown } | undefined;
			if (v && typeof v === "object") {
				const from = typeof v.from === "string" ? v.from : undefined;
				const to = typeof v.to === "string" ? v.to : undefined;
				if (from || to) out[field] = { from, to };
			}
		}
		return out;
	}

	async onOpen(): Promise<void> {
		// Refresh the board whenever notes change.
		this.registerEvent(this.app.metadataCache.on("changed", this.scheduleRender));
		this.registerEvent(this.app.vault.on("create", this.scheduleRender));
		this.registerEvent(this.app.vault.on("delete", this.scheduleRender));
		this.registerEvent(this.app.vault.on("rename", this.scheduleRender));
		// The initial render is driven by setState() (called with our boardId),
		// so we don't render here to avoid building the board twice on open.
	}

	async onClose(): Promise<void> {
		this.destroySortables();
		this.filterBar.closePopover();
	}

	/** Forces a re-render (e.g. after settings change). */
	refresh(): void {
		this.render();
	}

	private destroySortables(): void {
		this.sortables.forEach((s) => s.destroy());
		this.sortables = [];
	}

	/** Groups tasks by status, honoring the configured column order. */
	private buildColumns(tasks: Task[], board: BoardConfig): Column[] {
		const { statuses, showUntriaged } = board;
		const columns: Column[] = statuses.map((status) => ({ status, tasks: [] }));
		const index = new Map(columns.map((c) => [c.status, c]));

		let untriaged: Column | undefined;
		const getUntriaged = (): Column => {
			if (!untriaged) {
				untriaged = { status: UNTRIAGED, tasks: [] };
			}
			return untriaged;
		};

		for (const task of tasks) {
			const target = index.get(task.status);
			if (target) {
				target.tasks.push(task);
			} else if (showUntriaged) {
				getUntriaged().tasks.push(task);
			}
		}

		return untriaged ? [getUntriaged(), ...columns] : columns;
	}

	private render(): void {
		// The view may have been reopened with changed settings.
		const board = this.resolveBoard();
		this.destroySortables();

		const root = this.contentEl;
		root.empty();
		root.addClass("agile-kanban");

		if (!board) return;
		this.service = new TaskService(this.app, board);

		// Full task list feeds the filter menus; the filtered subset feeds both views.
		const allTasks = this.service.getTasks();
		const tasks = applyFilters(allTasks, this.filters);

		this.toolbar.render(root, board);
		this.filterBar.render(root, board, allTasks);

		this.renderSection(root, "board", "Board", (body) => {
			const boardEl = body.createDiv({ cls: "agile-board" });
			for (const col of this.buildColumns(tasks, board)) {
				this.renderColumn(boardEl, col, board);
			}
			this.renderAddColumn(boardEl, board);
			this.enableColumnReorder(boardEl, board);
		});

		this.renderSection(
			root,
			"timeline",
			"Timeline",
			(body) => {
				const timelineEl = body.createDiv();
				renderTimeline(timelineEl, tasks, board, (task) => this.openTask(task, board));
			},
			(actions) => {
				const gear = actions.createSpan({ cls: "agile-section-gear", text: "⚙" });
				gear.setAttribute("aria-label", "Timeline settings");
				gear.addEventListener("click", (e) => this.toolbar.openTimelineMenu(e, board));
			}
		);
	}

	/** Switches this view to another board and persists the choice. */
	private switchBoard(boardId: string): void {
		if (this.boardId === boardId) return;
		this.boardId = boardId;
		this.render();
		this.app.workspace.requestSaveLayout();
	}

	/** Persists the filter change in the view state and re-renders both views. */
	private commitFilterChange(): void {
		this.app.workspace.requestSaveLayout();
		this.render();
	}

	/** The "+ column" affordance appended after the last column. */
	private renderAddColumn(boardEl: HTMLElement, board: BoardConfig): void {
		const add = boardEl.createDiv({ cls: "agile-add-column", text: "+ Colonne" });
		add.addEventListener("click", () => {
			board.statuses.push("New column");
			this.plugin.saveSettings();
		});
	}

	/** Lets real columns be reordered by dragging their header. */
	private enableColumnReorder(boardEl: HTMLElement, board: BoardConfig): void {
		const sortable = Sortable.create(boardEl, {
			group: `agile-columns-${board.id}`,
			draggable: ".agile-column:not(.agile-column-untriaged)",
			handle: ".agile-column-header",
			// Don't start a drag (or block focus) when interacting with controls.
			filter: ".agile-column-edit, .agile-column-delete, .agile-inline-input",
			preventOnFilter: false,
			animation: 150,
			onEnd: () => {
				const order = Array.from(
					boardEl.querySelectorAll<HTMLElement>(
						".agile-column:not(.agile-column-untriaged)"
					)
				)
					.map((el) => el.dataset.status)
					.filter((s): s is string => !!s);
				board.statuses = order;
				this.plugin.saveSettings();
			},
		});
		this.sortables.push(sortable);
	}

	/** Renders one collapsible section (a clickable header + a body). */
	private renderSection(
		root: HTMLElement,
		key: SectionKey,
		label: string,
		buildBody: (body: HTMLElement) => void,
		buildHeaderActions?: (actions: HTMLElement) => void
	): void {
		const section = root.createDiv({ cls: `agile-section agile-section-${key}` });
		if (this.collapsed[key]) section.addClass("is-collapsed");

		const header = section.createDiv({ cls: "agile-section-header" });
		header.createSpan({ cls: "agile-section-chevron", text: "▾" });
		header.createSpan({ text: label });

		if (buildHeaderActions) {
			const actions = header.createDiv({ cls: "agile-section-actions" });
			// Interacting with header controls must not toggle the section.
			actions.addEventListener("click", (e) => e.stopPropagation());
			buildHeaderActions(actions);
		}

		const body = section.createDiv({ cls: "agile-section-body" });
		buildBody(body);

		header.addEventListener("click", () => {
			this.collapsed[key] = !this.collapsed[key];
			section.toggleClass("is-collapsed", this.collapsed[key]);
			this.app.workspace.requestSaveLayout();
		});
	}

	/** Opens the edit modal for a task. */
	private openTask(task: Task, board: BoardConfig): void {
		if (this.service) {
			new TaskEditModal(this.app, this.plugin, task, this.service, board).open();
		}
	}

	private renderColumn(boardEl: HTMLElement, col: Column, board: BoardConfig): void {
		const isUntriaged = col.status === UNTRIAGED;
		const colEl = boardEl.createDiv({ cls: "agile-column" });
		if (isUntriaged) colEl.addClass("agile-column-untriaged");
		colEl.dataset.status = col.status;

		const header = colEl.createDiv({ cls: "agile-column-header" });
		const title = header.createDiv({ cls: "agile-column-title" });
		const statusColor = !isUntriaged ? board.colors.status?.[col.status] : undefined;
		const dotColor = statusColor?.bg ?? statusColor?.text;
		if (dotColor) {
			title.createSpan({ cls: "agile-column-dot" }).style.backgroundColor = dotColor;
		}
		const titleText = title.createSpan({ cls: "agile-column-name", text: col.status });

		// The virtual "No status" column can't be renamed, deleted or reordered.
		if (!isUntriaged) {
			const actions = header.createDiv({ cls: "agile-column-actions" });
			const edit = actions.createSpan({ cls: "agile-column-edit", text: "✎" });
			edit.setAttribute("aria-label", "Rename column");
			edit.addEventListener("click", (e) => {
				e.stopPropagation();
				beginInlineEdit(
					titleText,
					col.status,
					(v) => {
						const i = board.statuses.indexOf(col.status);
						if (i === -1 || !v) return;
						board.statuses[i] = v;
						this.plugin.saveSettings();
					},
					() => this.render()
				);
			});
			const del = actions.createSpan({ cls: "agile-column-delete", text: "✕" });
			del.setAttribute("aria-label", "Delete column");
			del.addEventListener("click", (e) => {
				e.stopPropagation();
				const i = board.statuses.indexOf(col.status);
				if (i === -1) return;
				if (
					col.tasks.length > 0 &&
					!confirm(
						`Supprimer la colonne « ${col.status} » ? Ses ${col.tasks.length} tâche(s) tomberont dans « No status ».`
					)
				) {
					return;
				}
				board.statuses.splice(i, 1);
				this.plugin.saveSettings();
			});
		}

		header.createSpan({ cls: "agile-column-count", text: String(col.tasks.length) });

		const list = colEl.createDiv({ cls: "agile-card-list" });
		list.dataset.status = col.status;
		for (const task of col.tasks) {
			this.renderCard(list, task, board);
		}

		const addBtn = colEl.createDiv({ cls: "agile-add-card", text: "+ New task" });
		addBtn.addEventListener("click", () => this.onCreate(col.status));

		this.enableDragAndDrop(list, board);
	}

	private renderCard(list: HTMLElement, task: Task, board: BoardConfig): void {
		const card = list.createDiv({ cls: "agile-card" });
		card.dataset.path = task.file.path;

		card.createDiv({ cls: "agile-card-title", text: task.title });

		const colors = board.colors;
		const meta = card.createDiv({ cls: "agile-card-meta" });
		if (task.priority) {
			const span = meta.createSpan({
				cls: `agile-badge agile-prio-${task.priority.toLowerCase()}`,
				text: task.priority,
			});
			const c = colors.priority?.[task.priority];
			if (c) applyBadgeColor(span, c);
		}
		if (task.project) {
			const span = meta.createSpan({ cls: "agile-badge agile-project", text: task.project });
			const c = colors.project?.[task.project];
			if (c) applyBadgeColor(span, c);
		}
		if (task.epic) {
			const span = meta.createSpan({ cls: "agile-badge agile-epic", text: task.epic });
			const c = colors.epic?.[task.epic];
			if (c) applyBadgeColor(span, c);
		}
		if (task.due) {
			meta.createSpan({ cls: "agile-badge agile-due", text: `📅 ${task.due}` });
		}
		if (task.assignee) {
			const span = meta.createSpan({ cls: "agile-badge agile-assignee", text: `👤 ${task.assignee}` });
			const c = colors.assignee?.[task.assignee];
			if (c) applyBadgeColor(span, c);
		}

		card.addEventListener("click", () => this.openTask(task, board));
	}

	private enableDragAndDrop(list: HTMLElement, board: BoardConfig): void {
		const sortable = Sortable.create(list, {
			// Scope the group to this board so cards can't be dragged between two
			// boards opened side by side (which would write a foreign status).
			group: `agile-kanban-${board.id}`,
			animation: 150,
			ghostClass: "agile-card-ghost",
			onEnd: (evt: Sortable.SortableEvent) => {
				const cardEl = evt.item;
				const path = cardEl.dataset.path;
				const newStatus = (evt.to as HTMLElement).dataset.status;
				const oldStatus = (evt.from as HTMLElement).dataset.status;
				if (!path || !newStatus || newStatus === oldStatus) return;

				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile && this.service) {
					this.service.updateStatus(file, newStatus).catch((e) => {
						console.error("Agile: failed to update status", e);
						new Notice("Agile: could not update the status.");
						this.render();
					});
				}
			},
		});
		this.sortables.push(sortable);
	}

	private async onCreate(status: string): Promise<void> {
		if (!this.service) return;
		try {
			const file = await this.service.createTask(status);
			await this.app.workspace.getLeaf(false).openFile(file);
		} catch (e) {
			console.error("Agile: failed to create task", e);
			new Notice("Agile: could not create the task.");
		}
	}
}
