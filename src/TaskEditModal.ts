import { App, ColorComponent, Modal, Notice, Setting } from "obsidian";
import type AgilePlugin from "./main";
import type { BoardConfig } from "./settings";
import { UNTRIAGED, TaskService } from "./taskService";
import { DEFAULT_BADGE_COLOR, PRIORITY_DEFAULT_COLORS } from "./colors";
import type { BadgeColor } from "./colors";
import { PRIORITIES, TASK_FIELDS } from "./types";
import type { Task } from "./types";

type Channel = "bg" | "text";

/**
 * Task property editor (Notion-style) opened when clicking a Kanban card.
 * Writes to the note's frontmatter.
 */
export class TaskEditModal extends Modal {
	private plugin: AgilePlugin;
	private service: TaskService;
	private board: BoardConfig;
	private task: Task;

	// Values being edited.
	private status: string;
	private priority: string;
	private project: string;
	private epic: string;
	private assignee: string;
	private start: string;
	private due: string;

	/** Pending per-value color edits (merged into settings on save). */
	private pendingColors: Record<string, Record<string, BadgeColor>>;

	constructor(
		app: App,
		plugin: AgilePlugin,
		task: Task,
		service: TaskService,
		board: BoardConfig
	) {
		super(app);
		this.plugin = plugin;
		this.service = service;
		this.board = board;
		this.task = task;

		this.status = task.status === UNTRIAGED ? "" : task.status;
		this.priority = task.priority ?? "";
		this.project = task.project ?? "";
		this.epic = task.epic ?? "";
		this.assignee = task.assignee ?? "";
		this.start = task.start ?? "";
		this.due = task.due ?? "";

		// Deep-copy existing colors so edits stay pending until save.
		this.pendingColors = {};
		for (const [prop, byValue] of Object.entries(this.board.colors)) {
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
	 * Builds a color-aware property row: creates the Setting, delegates the input
	 * widget to `buildControl` (wired to update the value + resync the swatches),
	 * then attaches the background/text color pickers.
	 */
	private addRow(
		name: string,
		prop: string,
		getValue: () => string,
		setValue: (v: string) => void,
		buildControl: (setting: Setting, onChange: (v: string) => void) => void
	): void {
		const setting = new Setting(this.contentEl).setName(name);
		let resync = () => {};
		buildControl(setting, (v) => {
			setValue(v);
			resync();
		});
		resync = this.addColorControls(setting, prop, getValue);
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
		this.addRow("Status", "status", () => this.status, (v) => (this.status = v), (s, onChange) =>
			s.addDropdown((dd) => {
				dd.addOption("", "— No status —");
				const options = [...this.board.statuses];
				if (this.status && !options.includes(this.status)) options.push(this.status);
				options.forEach((o) => dd.addOption(o, o));
				dd.setValue(this.status).onChange(onChange);
			})
		);

		// --- Priority ---
		this.addRow("Priority", "priority", () => this.priority, (v) => (this.priority = v), (s, onChange) =>
			s.addDropdown((dd) => {
				dd.addOption("", "—");
				PRIORITIES.forEach((p) => dd.addOption(p, p));
				if (this.priority && !PRIORITIES.includes(this.priority as never)) {
					dd.addOption(this.priority, this.priority);
				}
				dd.setValue(this.priority).onChange(onChange);
			})
		);

		// --- Project ---
		this.addRow("Project", "project", () => this.project, (v) => (this.project = v), (s, onChange) =>
			s.addText((t) => t.setPlaceholder("Project name").setValue(this.project).onChange(onChange))
		);

		// --- Epic ---
		this.addRow("Epic", "epic", () => this.epic, (v) => (this.epic = v), (s, onChange) =>
			s.addText((t) => t.setPlaceholder("Epic name").setValue(this.epic).onChange(onChange))
		);

		// --- Assignee ---
		this.addRow("Assignee", "assignee", () => this.assignee, (v) => (this.assignee = v), (s, onChange) =>
			s.addText((t) => t.setPlaceholder("Person").setValue(this.assignee).onChange(onChange))
		);

		// --- Start date ---
		new Setting(contentEl).setName("Start date").addText((t) => {
			t.inputEl.type = "date";
			t.setValue(this.start).onChange((v) => (this.start = v));
		});

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
		const statusField = this.board.statusField;
		try {
			const fields: Record<string, string> = { [statusField]: this.status };
			for (const f of TASK_FIELDS) fields[f] = this[f];
			await this.service.updateFields(this.task.file, fields);
			// Persist pending color edits on this board and refresh open boards.
			this.board.colors = this.pendingColors;
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
