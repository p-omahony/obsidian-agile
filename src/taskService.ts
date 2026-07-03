import { App, normalizePath, TFile } from "obsidian";
import type { BoardConfig } from "./settings";
import { TASK_FIELDS } from "./types";
import type { Task, TaskField } from "./types";

/** Virtual status for tasks with no known status. */
export const UNTRIAGED = "No status";

/** Pre-filled frontmatter values for a freshly created task (blank unless listed). */
const NEW_TASK_DEFAULTS: Partial<Record<TaskField, string>> = { priority: "medium" };

export class TaskService {
	constructor(private app: App, private board: BoardConfig) {}

	/** True if the file belongs to the configured tasks folder. */
	private inFolder(file: TFile): boolean {
		const folder = this.board.tasksFolder.trim();
		if (folder === "") return true;
		const prefix = normalizePath(folder) + "/";
		return file.path.startsWith(prefix);
	}

	/** Converts a frontmatter value to a plain string (handles links/arrays). */
	private toStr(value: unknown): string | undefined {
		if (value === null || value === undefined) return undefined;
		if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
		return String(value);
	}

	/** Builds a Task from a file, or null if no usable frontmatter. */
	private buildTask(file: TFile): Task | null {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		const field = this.board.statusField;

		const rawStatus = fm ? this.toStr(fm[field]) : undefined;
		const status = rawStatus && rawStatus.length > 0 ? rawStatus : UNTRIAGED;

		// Title = first H1 otherwise file name.
		const h1 = cache?.headings?.find((h) => h.level === 1);
		const title = h1?.heading ?? file.basename;

		const fields = Object.fromEntries(
			TASK_FIELDS.map((f) => [f, fm ? this.toStr(fm[f]) : undefined])
		);
		return { file, title, status, ...fields };
	}

	/** Retrieves every task in the configured folder. */
	getTasks(): Task[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => this.inFolder(f))
			.map((f) => this.buildTask(f))
			.filter((t): t is Task => t !== null);
	}

	/**
	 * Creates a new task note with the given status pre-filled (minimal template).
	 * Returns the created file.
	 */
	async createTask(status: string): Promise<TFile> {
		const folder = this.board.tasksFolder.trim();
		await this.ensureFolder(folder);

		const path = this.uniqueName(folder, "New task");
		const field = this.board.statusField;
		const statusValue = status === UNTRIAGED ? "" : status;

		const content = [
			"---",
			`${field}: ${statusValue}`,
			...TASK_FIELDS.map((f) => `${f}: ${NEW_TASK_DEFAULTS[f] ?? ""}`),
			"---",
			"",
			"# New task",
			"",
			"Describe the task here…",
			"",
		].join("\n");

		return this.app.vault.create(path, content);
	}

	/** Updates a task status without altering the rest of the frontmatter. */
	async updateStatus(file: TFile, newStatus: string): Promise<void> {
		const field = this.board.statusField;
		const value = newStatus === UNTRIAGED ? "" : newStatus;
		await this.updateFields(file, { [field]: value });
	}

	/**
	 * Updates several frontmatter fields at once, leaving the others untouched.
	 * An empty value removes the field (keeps the frontmatter clean).
	 */
	async updateFields(file: TFile, fields: Record<string, string>): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			for (const [key, value] of Object.entries(fields)) {
				if (value === "" || value === undefined) {
					delete fm[key];
				} else {
					fm[key] = value;
				}
			}
		});
	}

	private async ensureFolder(folder: string): Promise<void> {
		if (folder === "") return;
		const path = normalizePath(folder);
		if (!this.app.vault.getAbstractFileByPath(path)) {
			await this.app.vault.createFolder(path);
		}
	}

	private uniqueName(folder: string, base: string): string {
		const prefix = folder === "" ? "" : normalizePath(folder) + "/";
		let path = `${prefix}${base}.md`;
		let i = 2;
		while (this.app.vault.getAbstractFileByPath(path)) {
			path = `${prefix}${base} ${i}.md`;
			i++;
		}
		return path;
	}
}
