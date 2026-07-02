/** Color helpers for property badges (shared, global palette). */

/** Background + text color override for a single property value. */
export interface BadgeColor {
	bg?: string;
	text?: string;
}

/** Default priority text colors — mirrors the .agile-prio-* rules in styles.css. */
export const PRIORITY_DEFAULT_COLORS: Record<string, string> = {
	low: "#78909c",
	medium: "#42a5f5",
	high: "#ffa726",
	urgent: "#ef5350",
};

/** Neutral fallback shown in a color picker when no color is set yet. */
export const DEFAULT_BADGE_COLOR = "#7e57c2";

/** Applies the background and/or text color overrides to a badge element. */
export function applyBadgeColor(el: HTMLElement, color: BadgeColor): void {
	if (color.bg) el.style.backgroundColor = color.bg;
	if (color.text) el.style.color = color.text;
}
