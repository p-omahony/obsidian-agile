import { TFile } from "obsidian";

/** A task = a Markdown note with frontmatter. */
export interface Task {
	file: TFile;
	title: string;
	status: string;
	priority?: string;
	project?: string;
	epic?: string;
	assignee?: string;
	start?: string;
	due?: string;
}

/** A Kanban column (groups tasks sharing the same status). */
export interface Column {
	status: string;
	tasks: Task[];
}

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Non-status task fields, in note/UI order. Single source of truth for the schema. */
export const TASK_FIELDS = ["priority", "project", "epic", "assignee", "start", "due"] as const;
export type TaskField = (typeof TASK_FIELDS)[number];
