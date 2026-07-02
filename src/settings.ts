import { App, PluginSettingTab, Setting } from "obsidian";
import type AgilePlugin from "./main";

export interface AgileSettings {
	/** Folder containing task notes (relative to the vault root). */
	tasksFolder: string;
	/** Name of the frontmatter field holding the status. */
	statusField: string;
	/** Ordered list of statuses → one column per status. */
	statuses: string[];
	/** If true, tasks with an unknown status are grouped in "No status". */
	showUntriaged: boolean;
}

export const DEFAULT_SETTINGS: AgileSettings = {
	tasksFolder: "Tasks",
	statusField: "status",
	statuses: ["To Do", "In Progress", "In Review", "Done"],
	showUntriaged: true,
};

export class AgileSettingTab extends PluginSettingTab {
	plugin: AgilePlugin;

	constructor(app: App, plugin: AgilePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Agile settings" });

		new Setting(containerEl)
			.setName("Tasks folder")
			.setDesc(
				"Vault folder scanned to build the board. Leave empty to scan the whole vault."
			)
			.addText((text) =>
				text
					.setPlaceholder("Tasks")
					.setValue(this.plugin.settings.tasksFolder)
					.onChange(async (value) => {
						this.plugin.settings.tasksFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Status field")
			.setDesc("Frontmatter field used to sort tasks into columns.")
			.addText((text) =>
				text
					.setPlaceholder("status")
					.setValue(this.plugin.settings.statusField)
					.onChange(async (value) => {
						this.plugin.settings.statusField = value.trim() || "status";
						await this.plugin.saveSettings();
					})
			);

		this.renderColumns(containerEl);

		new Setting(containerEl)
			.setName('Show the "No status" column')
			.setDesc(
				"Groups tasks with no status, or whose status matches no column."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showUntriaged)
					.onChange(async (value) => {
						this.plugin.settings.showUntriaged = value;
						await this.plugin.saveSettings();
					})
			);
	}

	/** Editable list of columns: rename, reorder, delete, add. */
	private renderColumns(containerEl: HTMLElement): void {
		const statuses = this.plugin.settings.statuses;

		new Setting(containerEl)
			.setName("Columns (statuses)")
			.setDesc(
				"Each column matches a value of the status field. The order below is the display order."
			)
			.setHeading();

		statuses.forEach((status, i) => {
			const setting = new Setting(containerEl);
			setting.addText((text) =>
				text.setValue(status).onChange(async (value) => {
					statuses[i] = value.trim();
					await this.plugin.saveSettings();
				})
			);
			setting.addExtraButton((b) =>
				b
					.setIcon("arrow-up")
					.setTooltip("Move up")
					.setDisabled(i === 0)
					.onClick(async () => {
						[statuses[i - 1], statuses[i]] = [statuses[i], statuses[i - 1]];
						await this.plugin.saveSettings();
						this.display();
					})
			);
			setting.addExtraButton((b) =>
				b
					.setIcon("arrow-down")
					.setTooltip("Move down")
					.setDisabled(i === statuses.length - 1)
					.onClick(async () => {
						[statuses[i + 1], statuses[i]] = [statuses[i], statuses[i + 1]];
						await this.plugin.saveSettings();
						this.display();
					})
			);
			setting.addExtraButton((b) =>
				b
					.setIcon("trash")
					.setTooltip("Delete column")
					.onClick(async () => {
						statuses.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					})
			);
		});

		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("+ Add column")
				.setCta()
				.onClick(async () => {
					statuses.push("New column");
					await this.plugin.saveSettings();
					this.display();
				})
		);
	}
}
