import { App, Modal, Notice, Setting } from "obsidian";
import type AgilePlugin from "./main";
import { UNTRIAGED, TaskService } from "./taskService";
import { PRIORITIES } from "./types";
import type { Task } from "./types";

/**
 * Task property editor (Notion-style) opened when clicking a Kanban card.
 * Writes to the note's frontmatter.
 */
export class TaskEditModal extends Modal {
	private plugin: AgilePlugin;
	private service: TaskService;
	private task: Task;

	// Values being edited.
	private status: string;
	private priority: string;
	private project: string;
	private assignee: string;
	private due: string;

	constructor(app: App, plugin: AgilePlugin, task: Task, service: TaskService) {
		super(app);
		this.plugin = plugin;
		this.service = service;
		this.task = task;

		this.status = task.status === UNTRIAGED ? "" : task.status;
		this.priority = task.priority ?? "";
		this.project = task.project ?? "";
		this.assignee = task.assignee ?? "";
		this.due = task.due ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("agile-edit-modal");

		contentEl.createEl("h3", { text: this.task.title });

		// --- Status ---
		new Setting(contentEl).setName("Status").addDropdown((dd) => {
			dd.addOption("", "— No status —");
			const options = [...this.plugin.settings.statuses];
			if (this.status && !options.includes(this.status)) {
				options.push(this.status);
			}
			options.forEach((s) => dd.addOption(s, s));
			dd.setValue(this.status).onChange((v) => (this.status = v));
		});

		// --- Priority ---
		new Setting(contentEl).setName("Priority").addDropdown((dd) => {
			dd.addOption("", "—");
			PRIORITIES.forEach((p) => dd.addOption(p, p));
			if (this.priority && !PRIORITIES.includes(this.priority as never)) {
				dd.addOption(this.priority, this.priority);
			}
			dd.setValue(this.priority).onChange((v) => (this.priority = v));
		});

		// --- Project ---
		new Setting(contentEl).setName("Project").addText((t) =>
			t
				.setPlaceholder("Project name")
				.setValue(this.project)
				.onChange((v) => (this.project = v))
		);

		// --- Assignee ---
		new Setting(contentEl).setName("Assignee").addText((t) =>
			t
				.setPlaceholder("Person")
				.setValue(this.assignee)
				.onChange((v) => (this.assignee = v))
		);

		// --- Due date ---
		new Setting(contentEl).setName("Due date").addText((t) => {
			t.inputEl.type = "date";
			t.setValue(this.due).onChange((v) => (this.due = v));
		});

		// --- Actions ---
		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Open note").onClick(() => {
					this.close();
					this.app.workspace.getLeaf(false).openFile(this.task.file);
				})
			)
			.addButton((b) =>
				b
					.setButtonText("Save")
					.setCta()
					.onClick(() => this.save())
			);
	}

	private async save(): Promise<void> {
		const statusField = this.plugin.settings.statusField;
		try {
			await this.service.updateFields(this.task.file, {
				[statusField]: this.status,
				priority: this.priority,
				project: this.project,
				assignee: this.assignee,
				due: this.due,
			});
			this.close();
		} catch (e) {
			console.error("Agile: failed to save the task", e);
			new Notice("Agile: could not save the properties.");
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
