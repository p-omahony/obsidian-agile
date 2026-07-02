import { ItemView, Notice, TFile, WorkspaceLeaf, debounce } from "obsidian";
import Sortable from "sortablejs";
import type AgilePlugin from "./main";
import { UNTRIAGED, TaskService } from "./taskService";
import { TaskEditModal } from "./TaskEditModal";
import type { Column, Task } from "./types";

export const VIEW_TYPE_KANBAN = "agile-kanban-view";

export class KanbanView extends ItemView {
	private plugin: AgilePlugin;
	private service: TaskService;
	private sortables: Sortable[] = [];
	/** Debounced re-render, reused for vault/cache events. */
	private scheduleRender = debounce(() => this.render(), 200, true);

	constructor(leaf: WorkspaceLeaf, plugin: AgilePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.service = new TaskService(this.app, plugin.settings);
	}

	getViewType(): string {
		return VIEW_TYPE_KANBAN;
	}

	getDisplayText(): string {
		return "Agile Kanban";
	}

	getIcon(): string {
		return "kanban-square";
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
	private buildColumns(tasks: Task[]): Column[] {
		const { statuses, showUntriaged } = this.plugin.settings;
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
		this.service = new TaskService(this.app, this.plugin.settings);
		this.destroySortables();

		const root = this.contentEl;
		root.empty();
		root.addClass("agile-kanban");

		const board = root.createDiv({ cls: "agile-board" });
		const columns = this.buildColumns(this.service.getTasks());

		for (const col of columns) {
			this.renderColumn(board, col);
		}
	}

	private renderColumn(board: HTMLElement, col: Column): void {
		const colEl = board.createDiv({ cls: "agile-column" });
		colEl.dataset.status = col.status;

		const header = colEl.createDiv({ cls: "agile-column-header" });
		header.createSpan({ cls: "agile-column-title", text: col.status });
		header.createSpan({ cls: "agile-column-count", text: String(col.tasks.length) });

		const list = colEl.createDiv({ cls: "agile-card-list" });
		list.dataset.status = col.status;
		for (const task of col.tasks) {
			this.renderCard(list, task);
		}

		const addBtn = colEl.createDiv({ cls: "agile-add-card", text: "+ New task" });
		addBtn.addEventListener("click", () => this.onCreate(col.status));

		this.enableDragAndDrop(list);
	}

	private renderCard(list: HTMLElement, task: Task): void {
		const card = list.createDiv({ cls: "agile-card" });
		card.dataset.path = task.file.path;

		card.createDiv({ cls: "agile-card-title", text: task.title });

		const meta = card.createDiv({ cls: "agile-card-meta" });
		if (task.priority) {
			meta.createSpan({
				cls: `agile-badge agile-prio-${task.priority.toLowerCase()}`,
				text: task.priority,
			});
		}
		if (task.project) {
			meta.createSpan({ cls: "agile-badge agile-project", text: task.project });
		}
		if (task.due) {
			meta.createSpan({ cls: "agile-badge agile-due", text: `📅 ${task.due}` });
		}
		if (task.assignee) {
			meta.createSpan({ cls: "agile-badge agile-assignee", text: `👤 ${task.assignee}` });
		}

		card.addEventListener("click", () => {
			new TaskEditModal(this.app, this.plugin, task, this.service).open();
		});
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
				if (file instanceof TFile) {
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
		try {
			const file = await this.service.createTask(status);
			await this.app.workspace.getLeaf(false).openFile(file);
		} catch (e) {
			console.error("Agile: failed to create task", e);
			new Notice("Agile: could not create the task.");
		}
	}
}
