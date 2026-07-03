import { ItemView, Notice, TFile, WorkspaceLeaf, debounce } from "obsidian";
import Sortable from "sortablejs";
import type AgilePlugin from "./main";
import type { BoardConfig } from "./settings";
import { UNTRIAGED, TaskService } from "./taskService";
import { TaskEditModal } from "./TaskEditModal";
import { renderTimeline } from "./timeline";
import { applyBadgeColor } from "./colors";
import type { Column, Task } from "./types";

export const VIEW_TYPE_KANBAN = "agile-kanban-view";

/** Which display the view is showing. */
type ViewMode = "board" | "timeline";

export class KanbanView extends ItemView {
	private plugin: AgilePlugin;
	private service: TaskService | null = null;
	private sortables: Sortable[] = [];
	/** Which board this view displays (persisted in the view state). */
	boardId = "";
	/** Active display mode (persisted in the view state). */
	mode: ViewMode = "board";
	/** Debounced re-render, reused for vault/cache events. */
	private scheduleRender = debounce(() => this.render(), 200, true);

	constructor(leaf: WorkspaceLeaf, plugin: AgilePlugin) {
		super(leaf);
		this.plugin = plugin;
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
		return { ...super.getState(), boardId: this.boardId, mode: this.mode };
	}

	async setState(state: unknown, result: unknown): Promise<void> {
		const s = state as { boardId?: string; mode?: ViewMode } | null;
		if (typeof s?.boardId === "string") this.boardId = s.boardId;
		if (s?.mode === "board" || s?.mode === "timeline") this.mode = s.mode;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await super.setState(state as any, result as any);
		this.render();
	}

	/** Resolves this view's board, falling back to the first defined one. */
	private resolveBoard(): BoardConfig | undefined {
		const boards = this.plugin.settings.boards;
		return boards.find((b) => b.id === this.boardId) ?? boards[0];
	}

	async onOpen(): Promise<void> {
		// Refresh the board whenever notes change.
		this.registerEvent(this.app.metadataCache.on("changed", this.scheduleRender));
		this.registerEvent(this.app.vault.on("create", this.scheduleRender));
		this.registerEvent(this.app.vault.on("delete", this.scheduleRender));
		this.registerEvent(this.app.vault.on("rename", this.scheduleRender));
		this.render();
	}

	async onClose(): Promise<void> {
		this.destroySortables();
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

		this.renderToolbar(root);

		const tasks = this.service.getTasks();
		if (this.mode === "timeline") {
			const timelineEl = root.createDiv();
			renderTimeline(timelineEl, tasks, board, (task) => this.openTask(task, board));
		} else {
			const boardEl = root.createDiv({ cls: "agile-board" });
			for (const col of this.buildColumns(tasks, board)) {
				this.renderColumn(boardEl, col, board);
			}
		}
	}

	/** Renders the Board / Timeline segmented switch. */
	private renderToolbar(root: HTMLElement): void {
		const toolbar = root.createDiv({ cls: "agile-toolbar" });
		const group = toolbar.createDiv({ cls: "agile-toolbar-switch" });

		const makeButton = (mode: ViewMode, label: string) => {
			const btn = group.createDiv({ cls: "agile-toolbar-btn", text: label });
			if (this.mode === mode) btn.addClass("is-active");
			btn.addEventListener("click", () => {
				if (this.mode === mode) return;
				this.mode = mode;
				this.app.workspace.requestSaveLayout();
				this.render();
			});
		};

		makeButton("board", "Board");
		makeButton("timeline", "Timeline");
	}

	/** Opens the edit modal for a task. */
	private openTask(task: Task, board: BoardConfig): void {
		if (this.service) {
			new TaskEditModal(this.app, this.plugin, task, this.service, board).open();
		}
	}

	private renderColumn(boardEl: HTMLElement, col: Column, board: BoardConfig): void {
		const colEl = boardEl.createDiv({ cls: "agile-column" });
		colEl.dataset.status = col.status;

		const header = colEl.createDiv({ cls: "agile-column-header" });
		const title = header.createDiv({ cls: "agile-column-title" });
		const statusColor =
			col.status !== UNTRIAGED
				? board.colors.status?.[col.status]
				: undefined;
		const dotColor = statusColor?.bg ?? statusColor?.text;
		if (dotColor) {
			title.createSpan({ cls: "agile-column-dot" }).style.backgroundColor = dotColor;
		}
		title.createSpan({ text: col.status });
		header.createSpan({ cls: "agile-column-count", text: String(col.tasks.length) });

		const list = colEl.createDiv({ cls: "agile-card-list" });
		list.dataset.status = col.status;
		for (const task of col.tasks) {
			this.renderCard(list, task, board);
		}

		const addBtn = colEl.createDiv({ cls: "agile-add-card", text: "+ New task" });
		addBtn.addEventListener("click", () => this.onCreate(col.status));

		this.enableDragAndDrop(list);
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

	private enableDragAndDrop(list: HTMLElement): void {
		const sortable = Sortable.create(list, {
			group: "agile-kanban",
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
