# Agile — Notion-style agile project management for Obsidian

Un tableau Kanban et une gestion de tâches façon Notion, directement dans Obsidian.
Le principe : **une tâche est une note Markdown avec du frontmatter**. Le tableau
Kanban est une *vue* sur ces notes — il n'y a pas de base de données séparée.
Déplacer une carte réécrit le frontmatter de la note.

## Fonctionnalités

- Tableau Kanban avec glisser-déposer (les colonnes sont vos statuts, configurables).
- Édition des propriétés façon Notion (priorité, projet, assigné, échéance…).
- Vue timeline et filtres par propriété.
- Édition en ligne du tableau (colonnes, réglages) sans quitter la vue.
- Aucune duplication : vos notes restent la seule source de vérité.

## Installation

### Via BRAT (recommandé, avant publication au store)

1. Installez le plugin **BRAT** (Obsidian42 - BRAT) depuis les plugins communautaires.
2. `BRAT: Add a beta plugin for testing` → collez l'URL de ce dépôt :
   `https://github.com/p-omahony/obsidian-agile`
3. Activez **Agile** dans Paramètres → Plugins tiers.

BRAT gère ensuite les mises à jour automatiquement à chaque nouvelle release.

### Manuelle

Copiez `main.js`, `manifest.json` et `styles.css` (depuis la dernière release)
dans `<vault>/.obsidian/plugins/agile/`, puis activez le plugin.

## Développement

```bash
npm install     # installe les dépendances (bundle sortablejs dans main.js)
npm run dev     # esbuild watch, sourcemap inline → main.js
npm run build   # typecheck tsc + bundle de production minifié
```

## Licence

MIT — voir [LICENSE](LICENSE).
