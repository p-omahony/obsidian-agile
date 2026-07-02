import { Plugin, WorkspaceLeaf } from "obsidian";
import { KanbanView, VIEW_TYPE_KANBAN } from "./KanbanView";
import { AgileSettings, AgileSettingTab, DEFAULT_SETTINGS } from "./settings";

export default class AgilePlugin extends Plugin {
	settings: AgileSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_KANBAN,
			(leaf) => new KanbanView(leaf, this)
		);

		this.addRibbonIcon("kanban-square", "Open Agile Kanban board", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-agile-kanban",
			name: "Open Agile Kanban board",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new AgileSettingTab(this.app, this));
	}

	onunload(): void {
		// Obsidian automatically detaches registered views on unload.
	}

	/** Opens the Kanban board in a tab, or reveals it if already open. */
	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_KANBAN);

		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_KANBAN, active: true });
		}

		workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
