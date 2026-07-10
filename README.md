# Agile — Notion-style agile project management for Obsidian

A Kanban board and Notion-style task management, right inside Obsidian.
The core idea: **a task is a Markdown note with frontmatter**. The Kanban
board is a *view* over those notes — there is no separate database.
Moving a card rewrites the note's frontmatter.

## Features

- Kanban board with drag & drop (columns are your statuses, fully configurable).
- Notion-style property editing (priority, project, assignee, due date…).
- Timeline view and per-property filters.
- Inline board editing (columns, settings) without leaving the view.
- No duplication: your notes remain the single source of truth.

## Installation

### Via BRAT (recommended, before store publication)

1. Install the **BRAT** plugin (Obsidian42 - BRAT) from the community plugins.
2. `BRAT: Add a beta plugin for testing` → paste this repository's URL:
   `https://github.com/p-omahony/obsidian-agile`
3. Enable **Agile** in Settings → Community plugins.

BRAT then handles updates automatically on every new release.

### Manual

Copy `main.js`, `manifest.json` and `styles.css` (from the latest release)
into `<vault>/.obsidian/plugins/agile/`, then enable the plugin.

## Development

```bash
npm install     # install dependencies (bundles sortablejs into main.js)
npm run dev     # esbuild watch, inline sourcemap → main.js
npm run build   # tsc typecheck + minified production bundle
```

## License

MIT — see [LICENSE](LICENSE).
