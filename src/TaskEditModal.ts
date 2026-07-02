import { App, ColorComponent, Modal, Notice, Setting } from "obsidian";
import type AgilePlugin from "./main";
import { UNTRIAGED, TaskService } from "./taskService";
import { DEFAULT_BADGE_COLOR, PRIORITY_DEFAULT_COLORS } from "./colors";
import type { BadgeColor } from "./colors";
import { PRIORITIES } from "./types";
import type { Task } from "./types";

type Channel = "bg" | "text";

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

	/** Pending per-value color edits (merged into settings on save). */
	private pendingColors: Record<string, Record<string, BadgeColor>>;

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

		// Deep-copy existing colors so edits stay pending until save.
		this.pendingColors = {};
		for (const [prop, byValue] of Object.entries(this.plugin.settings.colors)) {
			this.pendingColors[prop] = {};
			for (const [value, color] of Object.entries(byValue)) {
				this.pendingColors[prop][value] = { ...color };
			}
		}
	}

	/** Effective color of a channel for a value (falls back to sensible defaults). */
	private colorFor(prop: string, value: string, channel: Channel): string {
		const stored = this.pendingColors[prop]?.[value]?.[channel];
		if (stored) return stored;
		if (channel === "text" && prop === "priority" && PRIORITY_DEFAULT_COLORS[value]) {
			return PRIORITY_DEFAULT_COLORS[value];
		}
		return DEFAULT_BADGE_COLOR;
	}

	/** Records a pending color channel for a value (ignored while the value is empty). */
	private setColor(prop: string, value: string, channel: Channel, hex: string): void {
		if (!value) return;
		const byValue = (this.pendingColors[prop] ??= {});
		(byValue[value] ??= {})[channel] = hex;
	}

	/**
	 * Adds background + text color pickers to a Setting row, keyed by the property's
	 * current value. Returns a resync() to refresh both swatches when the value changes.
	 */
	private addColorControls(
		setting: Setting,
		prop: string,
		getValue: () => string
	): () => void {
		const bg = this.addChannelControl(setting, prop, "bg", getValue, "Background color");
		const text = this.addChannelControl(setting, prop, "text", getValue, "Text color");
		return () => {
			bg.setValue(this.colorFor(prop, getValue(), "bg"));
			text.setValue(this.colorFor(prop, getValue(), "text"));
		};
	}

	private addChannelControl(
		setting: Setting,
		prop: string,
		channel: Channel,
		getValue: () => string,
		title: string
	): ColorComponent {
		let picker!: ColorComponent;
		setting.addColorPicker((cp) => {
			picker = cp;
			cp.setValue(this.colorFor(prop, getValue(), channel));
			cp.onChange((hex) => this.setColor(prop, getValue(), channel, hex));
			const el = (cp as { colorPickerEl?: HTMLElement }).colorPickerEl;
			el?.setAttribute("aria-label", title);
			el?.setAttribute("title", title);
		});
		return picker;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("agile-edit-modal");

		contentEl.createEl("h3", { text: this.task.title });

		// --- Status ---
		const statusSetting = new Setting(contentEl).setName("Status");
		let syncStatus = () => {};
		statusSetting.addDropdown((dd) => {
			dd.addOption("", "— No status —");
			const options = [...this.plugin.settings.statuses];
			if (this.status && !options.includes(this.status)) {
				options.push(this.status);
			}
			options.forEach((s) => dd.addOption(s, s));
			dd.setValue(this.status).onChange((v) => {
				this.status = v;
				syncStatus();
			});
		});
		syncStatus = this.addColorControls(statusSetting, "status", () => this.status);

		// --- Priority ---
		const prioSetting = new Setting(contentEl).setName("Priority");
		let syncPrio = () => {};
		prioSetting.addDropdown((dd) => {
			dd.addOption("", "—");
			PRIORITIES.forEach((p) => dd.addOption(p, p));
			if (this.priority && !PRIORITIES.includes(this.priority as never)) {
				dd.addOption(this.priority, this.priority);
			}
			dd.setValue(this.priority).onChange((v) => {
				this.priority = v;
				syncPrio();
			});
		});
		syncPrio = this.addColorControls(prioSetting, "priority", () => this.priority);

		// --- Project ---
		const projectSetting = new Setting(contentEl).setName("Project");
		let syncProject = () => {};
		projectSetting.addText((t) =>
			t
				.setPlaceholder("Project name")
				.setValue(this.project)
				.onChange((v) => {
					this.project = v;
					syncProject();
				})
		);
		syncProject = this.addColorControls(projectSetting, "project", () => this.project);

		// --- Assignee ---
		const assigneeSetting = new Setting(contentEl).setName("Assignee");
		let syncAssignee = () => {};
		assigneeSetting.addText((t) =>
			t
				.setPlaceholder("Person")
				.setValue(this.assignee)
				.onChange((v) => {
					this.assignee = v;
					syncAssignee();
				})
		);
		syncAssignee = this.addColorControls(assigneeSetting, "assignee", () => this.assignee);

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
			// Persist pending color edits globally and refresh open boards.
			this.plugin.settings.colors = this.pendingColors;
			await this.plugin.saveSettings();
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
