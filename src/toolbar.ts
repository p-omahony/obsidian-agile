/** The board toolbar: inline-editable board settings (name, tasks folder, status
 * field) plus the board-management, folder, gear and timeline menus. Mutates the
 * BoardConfig in place and drives everything else through narrow injected
 * callbacks (`deps`) — it holds no reference to the plugin, vault or host view,
 * mirroring FilterBar's decoupled style. */

import { Menu } from "obsidian";
import { defaultBoard } from "./settings";
import type { BoardConfig, TimelineScale } from "./settings";
import { beginInlineEdit } from "./inlineEdit";

/** Everything the toolbar needs from its host, as narrow callbacks. */
export interface ToolbarDeps {
	/** The live boards array (mutated in place for add/delete). */
	getBoards: () => BoardConfig[];
	/** Persists the current settings (and refreshes open views). */
	saveSettings: () => void;
	/** Selectable task-folder paths, already filtered and sorted. */
	getFolders: () => string[];
	/** Switches the host view to another board (persists the choice). */
	switchBoard: (boardId: string) => void;
	/** Re-renders the host view (used to rebuild labels after inline edits). */
	rerender: () => void;
}

export class Toolbar {
	constructor(private deps: ToolbarDeps) {}

	/** Board-level settings, editable inline at the top of the view. */
	render(root: HTMLElement, board: BoardConfig): void {
		const bar = root.createDiv({ cls: "agile-toolbar" });

		// Board name (click to rename) + board management menu.
		const nameEl = bar.createSpan({
			cls: "agile-toolbar-item agile-toolbar-name",
			text: board.name || "Board",
		});
		nameEl.addEventListener("click", () =>
			beginInlineEdit(
				nameEl,
				board.name,
				(v) => {
					board.name = v || "Board";
					this.deps.saveSettings();
				},
				this.deps.rerender
			)
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
			beginInlineEdit(
				statusVal,
				board.statusField,
				(v) => {
					board.statusField = v || "status";
					this.deps.saveSettings();
				},
				this.deps.rerender
			)
		);

		bar.createDiv({ cls: "agile-toolbar-spacer" });

		const gear = bar.createSpan({ cls: "agile-toolbar-item agile-toolbar-gear", text: "⚙" });
		gear.setAttribute("aria-label", "Board settings");
		gear.addEventListener("click", (e) => this.openGearMenu(e, board));
	}

	/** Settings menu specific to the timeline section (rendered in its header). */
	openTimelineMenu(evt: MouseEvent, board: BoardConfig): void {
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
						this.deps.saveSettings();
					})
			);
		}
		menu.showAtMouseEvent(evt);
	}

	/** Menu to switch board, or add/delete boards. */
	private openBoardsMenu(evt: MouseEvent, board: BoardConfig): void {
		const boards = this.deps.getBoards();
		const menu = new Menu();
		for (const b of boards) {
			menu.addItem((item) =>
				item
					.setTitle(b.name || "Board")
					.setChecked(b.id === board.id)
					.onClick(() => this.deps.switchBoard(b.id))
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Nouveau board")
				.setIcon("plus")
				.onClick(() => {
					const nb = defaultBoard("New board");
					boards.push(nb);
					this.deps.saveSettings();
					this.deps.switchBoard(nb.id);
				})
		);
		menu.addItem((item) =>
			item
				.setTitle("Supprimer ce board")
				.setIcon("trash")
				.setDisabled(boards.length <= 1)
				.onClick(() => {
					const idx = boards.findIndex((b) => b.id === board.id);
					if (idx === -1 || boards.length <= 1) return;
					boards.splice(idx, 1);
					this.deps.saveSettings();
					this.deps.switchBoard(boards[0].id);
				})
		);
		menu.showAtMouseEvent(evt);
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
					this.deps.saveSettings();
				})
		);
		for (const path of this.deps.getFolders()) {
			menu.addItem((item) =>
				item
					.setTitle(path)
					.setChecked(board.tasksFolder === path)
					.onClick(() => {
						board.tasksFolder = path;
						this.deps.saveSettings();
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
					this.deps.saveSettings();
				})
		);
		menu.showAtMouseEvent(evt);
	}
}
