import { App, PluginSettingTab, Setting } from "obsidian";
import type AgilePlugin from "./main";
import type { BadgeColor } from "./colors";

/** Time axis granularity for the timeline view. */
export type TimelineScale = "day" | "week" | "month";

/** A single Kanban board: an independent configuration over the vault's notes. */
export interface BoardConfig {
	/** Stable unique identifier (persisted in the view state). */
	id: string;
	/** Display name (tab title, selection menu). */
	name: string;
	/** Folder containing task notes (relative to the vault root). */
	tasksFolder: string;
	/** Name of the frontmatter field holding the status. */
	statusField: string;
	/** Ordered list of statuses → one column per status. */
	statuses: string[];
	/** If true, tasks with an unknown status are grouped in "No status". */
	showUntriaged: boolean;
	/** Time axis granularity used by the timeline view. */
	timelineScale: TimelineScale;
	/**
	 * Per-value badge colors (background + text), indexed by property then value.
	 * e.g. { priority: { high: { bg: "#402b2b", text: "#ef5350" } } }.
	 * The "status" key is used regardless of `statusField`.
	 */
	colors: Record<string, Record<string, BadgeColor>>;
}

export interface AgileSettings {
	/** Every board defined in this vault (at least one). */
	boards: BoardConfig[];
}

/** Generates a reasonably unique id without relying on external state. */
function generateId(): string {
	const c = (globalThis as { crypto?: Crypto }).crypto;
	if (c?.randomUUID) return c.randomUUID();
	return `board-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** A fresh board with the historical defaults. */
export function defaultBoard(name = "Board"): BoardConfig {
	return {
		id: generateId(),
		name,
		tasksFolder: "Tasks",
		statusField: "status",
		statuses: ["To Do", "In Progress", "In Review", "Done"],
		showUntriaged: true,
		timelineScale: "week",
		colors: {},
	};
}

export const DEFAULT_SETTINGS: AgileSettings = {
	boards: [defaultBoard()],
};

/** Shape of the pre-boards (v1) settings, kept for migration. */
interface LegacySettings {
	tasksFolder?: string;
	statusField?: string;
	statuses?: string[];
	showUntriaged?: boolean;
	colors?: Record<string, Record<string, BadgeColor>>;
}

/**
 * Normalizes raw persisted data into the current settings shape.
 * - Empty/absent → the default single board.
 * - Legacy (top-level `statuses`, no `boards`) → wrapped into one "Board".
 * - Current shape → returned as-is (with a safety net for an empty board list).
 */
export function migrateSettings(raw: unknown): AgileSettings {
	const data = (raw ?? {}) as Partial<AgileSettings> & LegacySettings;

	if (Array.isArray(data.boards) && data.boards.length > 0) {
		return { boards: data.boards };
	}

	if (Array.isArray(data.statuses)) {
		const board = defaultBoard();
		return {
			boards: [
				{
					...board,
					tasksFolder: data.tasksFolder ?? board.tasksFolder,
					statusField: data.statusField ?? board.statusField,
					statuses: data.statuses,
					showUntriaged: data.showUntriaged ?? board.showUntriaged,
					colors: data.colors ?? board.colors,
				},
			],
		};
	}

	return { boards: [defaultBoard()] };
}

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

		this.plugin.settings.boards.forEach((board, i) => {
			this.renderBoard(containerEl, board, i);
		});

		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("+ Add board")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.boards.push(defaultBoard("New board"));
					await this.plugin.saveSettings();
					this.display();
				})
		);
	}

	/** Renders the editable configuration for a single board. */
	private renderBoard(containerEl: HTMLElement, board: BoardConfig, i: number): void {
		const boards = this.plugin.settings.boards;

		const heading = new Setting(containerEl).setName(board.name || "Board").setHeading();
		heading.addExtraButton((b) =>
			b
				.setIcon("trash")
				.setTooltip("Delete board")
				.setDisabled(boards.length <= 1)
				.onClick(async () => {
					boards.splice(i, 1);
					await this.plugin.saveSettings();
					this.display();
				})
		);

		this.textSetting(
			containerEl,
			"Board name",
			"Shown in the tab title and the board selection menu.",
			"Board",
			() => board.name,
			(v) => (board.name = v)
		);

		this.textSetting(
			containerEl,
			"Tasks folder",
			"Vault folder scanned to build the board. Leave empty to scan the whole vault.",
			"Tasks",
			() => board.tasksFolder,
			(v) => (board.tasksFolder = v)
		);

		this.textSetting(
			containerEl,
			"Status field",
			"Frontmatter field used to sort tasks into columns.",
			"status",
			() => board.statusField,
			(v) => (board.statusField = v || "status")
		);

		this.renderColumns(containerEl, board);

		new Setting(containerEl)
			.setName('Show the "No status" column')
			.setDesc(
				"Groups tasks with no status, or whose status matches no column."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(board.showUntriaged)
					.onChange(async (value) => {
						board.showUntriaged = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Timeline scale")
			.setDesc("Granularity of the time axis in the timeline view.")
			.addDropdown((dd) =>
				dd
					.addOption("day", "Day")
					.addOption("week", "Week")
					.addOption("month", "Month")
					.setValue(board.timelineScale ?? "week")
					.onChange(async (value) => {
						board.timelineScale = value as TimelineScale;
						await this.plugin.saveSettings();
					})
			);
	}

	/** A single text row whose value is trimmed and persisted on every change. */
	private textSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		placeholder: string,
		get: () => string,
		set: (value: string) => void
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) =>
				text
					.setPlaceholder(placeholder)
					.setValue(get())
					.onChange(async (value) => {
						set(value.trim());
						await this.plugin.saveSettings();
					})
			);
	}

	/** Swaps two statuses, persists, and re-renders the settings tab. */
	private async swap(statuses: string[], i: number, j: number): Promise<void> {
		[statuses[i], statuses[j]] = [statuses[j], statuses[i]];
		await this.plugin.saveSettings();
		this.display();
	}

	/** Editable list of columns: rename, reorder, delete, add. */
	private renderColumns(containerEl: HTMLElement, board: BoardConfig): void {
		const statuses = board.statuses;

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
					.onClick(() => this.swap(statuses, i, i - 1))
			);
			setting.addExtraButton((b) =>
				b
					.setIcon("arrow-down")
					.setTooltip("Move down")
					.setDisabled(i === statuses.length - 1)
					.onClick(() => this.swap(statuses, i, i + 1))
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
				.onClick(async () => {
					statuses.push("New column");
					await this.plugin.saveSettings();
					this.display();
				})
		);
	}
}
