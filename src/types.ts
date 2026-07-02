import { TFile } from "obsidian";

/** A task = a Markdown note with frontmatter. */
export interface Task {
	file: TFile;
	title: string;
	status: string;
	priority?: string;
	project?: string;
	assignee?: string;
	due?: string;
}

/** A Kanban column (groups tasks sharing the same status). */
export interface Column {
	status: string;
	tasks: Task[];
}

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
