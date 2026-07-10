/**
 * Turns a label element into an inline text input, focused and selected.
 * Commits (trimmed) on blur/Enter, cancels on Escape; either way calls `rerender`
 * to rebuild the label (a save typically re-renders too, this covers the cancel path).
 */
export function beginInlineEdit(
	labelEl: HTMLElement,
	current: string,
	onCommit: (value: string) => void,
	rerender: () => void
): void {
	labelEl.empty();
	const input = labelEl.createEl("input", { cls: "agile-inline-input" });
	input.type = "text";
	input.value = current;
	input.focus();
	input.select();
	// Clicking inside the input must not re-trigger the label's edit handler.
	input.addEventListener("click", (e) => e.stopPropagation());

	let done = false;
	const commit = (save: boolean) => {
		if (done) return;
		done = true;
		if (save) onCommit(input.value.trim());
		rerender();
	};
	input.addEventListener("blur", () => commit(true));
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			commit(true);
		} else if (e.key === "Escape") {
			e.preventDefault();
			commit(false);
		}
	});
}
