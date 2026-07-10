import { ItemView, Menu, Notice, TFile, TFolder, WorkspaceLeaf, debounce } from "obsidian";
import Sortable from "sortablejs";
import type AgilePlugin from "./main";
import { defaultBoard } from "./settings";
import type { BoardConfig, TimelineScale } from "./settings";
import { UNTRIAGED, TaskService } from "./taskService";
import { TaskEditModal } from "./TaskEditModal";
import { renderTimeline } from "./timeline";
import { applyBadgeColor } from "./colors";
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
		return { ...super.getState(), boardId: this.boardId, collapsed: { ...this.collapsed } };
	}

	async setState(state: unknown, result: unknown): Promise<void> {
		const s = state as { boardId?: string; collapsed?: Partial<Record<SectionKey, unknown>> } | null;
		if (typeof s?.boardId === "string") this.boardId = s.boardId;
		this.collapsed = {
			board: s?.collapsed?.board === true,
			timeline: s?.collapsed?.timeline === true,
		};
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
		// The initial render is driven by setState() (called with our boardId),
		// so we don't render here to avoid building the board twice on open.
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

		const tasks = this.service.getTasks();

		this.renderToolbar(root, board);

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
				gear.addEventListener("click", (e) => this.openTimelineMenu(e, board));
			}
		);
	}

	/** Board-level settings, editable inline at the top of the view. */
	private renderToolbar(root: HTMLElement, board: BoardConfig): void {
		const bar = root.createDiv({ cls: "agile-toolbar" });

		// Board name (click to rename) + board management menu.
		const nameEl = bar.createSpan({
			cls: "agile-toolbar-item agile-toolbar-name",
			text: board.name || "Board",
		});
		nameEl.addEventListener("click", () =>
			this.beginInlineEdit(nameEl, board.name, (v) => {
				board.name = v || "Board";
				this.plugin.saveSettings();
			})
		);

		const boardsBtn = bar.createSpan({ cls: "agile-toolbar-item agile-toolbar-caret", text: "▾" });
		boardsBtn.setAttribute("aria-label", "Switch board");
		boardsBtn.addEventListener("click", (e) => this.openBoardsMenu(e, board));

		bar.createSpan({ cls: "agile-toolbar-sep" });

		// Tasks folder (menu of vault folders).
		const folderEl = bar.createSpan({ cls: "agile-toolbar-item" });
		folderEl.appendText("Dossier : ");
		folderEl.createSpan({ cls: "agile-toolbar-value", text: board.tasksFolder || "Vault entier" });
		folderEl.appendText(" ▾");
		folderEl.addEventListener("click", (e) => this.openFolderMenu(e, board));

		// Status field (click to edit).
		const statusEl = bar.createSpan({ cls: "agile-toolbar-item" });
		statusEl.appendText("Statut : ");
		const statusVal = statusEl.createSpan({ cls: "agile-toolbar-value", text: board.statusField });
		statusVal.addEventListener("click", () =>
			this.beginInlineEdit(statusVal, board.statusField, (v) => {
				board.statusField = v || "status";
				this.plugin.saveSettings();
			})
		);

		bar.createDiv({ cls: "agile-toolbar-spacer" });

		const gear = bar.createSpan({ cls: "agile-toolbar-item agile-toolbar-gear", text: "⚙" });
		gear.setAttribute("aria-label", "Board settings");
		gear.addEventListener("click", (e) => this.openGearMenu(e, board));
	}

	/**
	 * Turns a label element into an inline text input, focused and selected.
	 * Commits (trimmed) on blur/Enter, cancels on Escape; either way re-renders.
	 */
	private beginInlineEdit(
		labelEl: HTMLElement,
		current: string,
		onCommit: (value: string) => void
	): void {
		labelEl.empty();
		const input = labelEl.createEl("input", { cls: "agile-inline-input" });
		input.type = "text";
		input.value = current;
		input.focus();
		input.select();
		// Clicking inside the input must not re-trigger the label's edit handler.
		input.addEventListener("click", (e) => e.stopPropagation());

		let done = false;
		const commit = (save: boolean) => {
			if (done) return;
			done = true;
			if (save) onCommit(input.value.trim());
			// Rebuild the label; if onCommit saved, saveSettings also re-renders.
			this.render();
		};
		input.addEventListener("blur", () => commit(true));
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				commit(true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				commit(false);
			}
		});
	}

	/** Menu to switch board, or add/delete boards. */
	private openBoardsMenu(evt: MouseEvent, board: BoardConfig): void {
		const boards = this.plugin.settings.boards;
		const menu = new Menu();
		for (const b of boards) {
			menu.addItem((item) =>
				item
					.setTitle(b.name || "Board")
					.setChecked(b.id === board.id)
					.onClick(() => this.switchBoard(b.id))
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Nouveau board")
				.setIcon("plus")
				.onClick(async () => {
					const nb = defaultBoard("New board");
					boards.push(nb);
					await this.plugin.saveSettings();
					this.switchBoard(nb.id);
				})
		);
		menu.addItem((item) =>
			item
				.setTitle("Supprimer ce board")
				.setIcon("trash")
				.setDisabled(boards.length <= 1)
				.onClick(async () => {
					const idx = boards.findIndex((b) => b.id === board.id);
					if (idx === -1 || boards.length <= 1) return;
					boards.splice(idx, 1);
					await this.plugin.saveSettings();
					this.switchBoard(boards[0].id);
				})
		);
		menu.showAtMouseEvent(evt);
	}

	/** Switches this view to another board and persists the choice. */
	private switchBoard(boardId: string): void {
		if (this.boardId === boardId) return;
		this.boardId = boardId;
		this.render();
		this.app.workspace.requestSaveLayout();
	}

	/** Menu listing the vault's folders to pick the board's task folder. */
	private openFolderMenu(evt: MouseEvent, board: BoardConfig): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Vault entier")
				.setChecked(!board.tasksFolder)
				.onClick(() => {
					board.tasksFolder = "";
					this.plugin.saveSettings();
				})
		);
		const folders = this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
			.sort((a, b) => a.path.localeCompare(b.path));
		for (const folder of folders) {
			menu.addItem((item) =>
				item
					.setTitle(folder.path)
					.setChecked(board.tasksFolder === folder.path)
					.onClick(() => {
						board.tasksFolder = folder.path;
						this.plugin.saveSettings();
					})
			);
		}
		menu.showAtMouseEvent(evt);
	}

	/** Overflow menu for less-frequent board settings. */
	private openGearMenu(evt: MouseEvent, board: BoardConfig): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle('Afficher la colonne « No status »')
				.setChecked(board.showUntriaged)
				.onClick(() => {
					board.showUntriaged = !board.showUntriaged;
					this.plugin.saveSettings();
				})
		);
		menu.showAtMouseEvent(evt);
	}

	/** Settings menu specific to the timeline section. */
	private openTimelineMenu(evt: MouseEvent, board: BoardConfig): void {
		const menu = new Menu();
		const scales: { value: TimelineScale; label: string }[] = [
			{ value: "day", label: "Échelle : Jour" },
			{ value: "week", label: "Échelle : Semaine" },
			{ value: "month", label: "Échelle : Mois" },
		];
		for (const s of scales) {
			menu.addItem((item) =>
				item
					.setTitle(s.label)
					.setChecked(board.timelineScale === s.value)
					.onClick(() => {
						board.timelineScale = s.value;
						this.plugin.saveSettings();
					})
			);
		}
		menu.showAtMouseEvent(evt);
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
				this.beginInlineEdit(titleText, col.status, (v) => {
					const i = board.statuses.indexOf(col.status);
					if (i === -1 || !v) return;
					board.statuses[i] = v;
					this.plugin.saveSettings();
				});
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
