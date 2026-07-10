import { Menu, Plugin } from "obsidian";
import { KanbanView, VIEW_TYPE_KANBAN } from "./KanbanView";
import { AgileSettings, AgileSettingTab, migrateSettings } from "./settings";

export default class AgilePlugin extends Plugin {
	settings: AgileSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_KANBAN,
			(leaf) => new KanbanView(leaf, this)
		);

		this.addRibbonIcon("kanban-square", "Open Agile Kanban board", (evt) => {
			this.openBoardPicker(evt);
		});

		this.addCommand({
			id: "open-agile-kanban",
			name: "Open Agile Kanban board",
			callback: () => this.openBoardPicker(),
		});

		this.addSettingTab(new AgileSettingTab(this.app, this));
	}

	onunload(): void {
		// Obsidian automatically detaches registered views on unload.
	}

	/**
	 * Opens a board directly if there is only one; otherwise shows a menu to
	 * pick which board to open.
	 */
	private openBoardPicker(evt?: MouseEvent): void {
		const boards = this.settings.boards;
		if (boards.length === 0) return;
		if (boards.length === 1) {
			this.activateView(boards[0].id);
			return;
		}

		const menu = new Menu();
		for (const board of boards) {
			menu.addItem((item) =>
				item
					.setTitle(board.name || "Board")
					.setIcon("kanban-square")
					.onClick(() => this.activateView(board.id))
			);
		}
		if (evt) {
			menu.showAtMouseEvent(evt);
		} else {
			menu.showAtPosition({ x: 0, y: 0 });
		}
	}

	/** Opens the given board in a tab, or reveals it if already open. */
	async activateView(boardId: string): Promise<void> {
		const { workspace } = this.app;

		// Read boardId from the persisted view state, not leaf.view: a leaf that
		// hasn't been activated yet exposes a DeferredView whose boardId is undefined.
		const existing = workspace
			.getLeavesOfType(VIEW_TYPE_KANBAN)
			.find((leaf) => leaf.getViewState().state?.boardId === boardId);

		if (existing) {
			workspace.revealLeaf(existing);
			return;
		}

		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_KANBAN,
			active: true,
			state: { boardId },
		});
		workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		this.settings = migrateSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Refresh open Kanban boards to reflect the new settings.
		this.app.workspace
			.getLeavesOfType(VIEW_TYPE_KANBAN)
			.forEach((leaf) => {
				if (leaf.view instanceof KanbanView) {
					leaf.view.refresh();
				}
			});
	}
}
