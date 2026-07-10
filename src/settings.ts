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
		// Backfill fields added after a board was persisted (e.g. colors,
		// timelineScale) so later reads never hit an undefined key.
		return { boards: data.boards.map((b) => ({ ...defaultBoard(), ...b })) };
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
