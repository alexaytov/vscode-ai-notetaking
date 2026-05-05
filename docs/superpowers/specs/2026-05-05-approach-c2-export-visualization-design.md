# Approach C2: Export & Visualization — Design Spec

## Overview

Two features that produce visual output artifacts: a static wiki site generated from workspace notes, and an interactive knowledge graph showing note relationships.

## Features

### 1. Static Site Export (Simple Wiki)

**Goal:** Generate a browsable HTML site from workspace notes with sidebar navigation and interlinked pages.

**Command:** `ai-notes.exportSite` ("AI Notes: Export as Static Site")

**Output structure:**
```
_site/
├── index.html          (homepage with recent notes + tag cloud)
├── graph.html          (interactive knowledge graph page)
├── notes/
│   ├── note-name.html  (one page per note)
│   └── ...
├── tags/
│   ├── tag-name.html   (tag index pages listing tagged notes)
│   └── ...
├── css/
│   └── style.css       (wiki theme stylesheet)
└── js/
    └── graph.js        (D3 knowledge graph script)
```

**Page layout:**
- Clean sans-serif theme (system fonts: -apple-system, BlinkMacSystemFont, sans-serif)
- Sidebar: folder tree navigation + tag list with counts
- Main content area: rendered markdown (using `marked` library already in deps)
- Footer on each page: backlinks section showing notes that link to this one
- All markdown relative links (`[text](path.md)`) rewritten to `<a href="../notes/target.html">`

**Homepage (index.html):**
- Title: workspace folder name
- Recent notes: 10 most recent notes sorted by filename date (DD-MM-YYYY pattern)
- Tag cloud: all tags as links to their respective tag index pages, sized by frequency

**Tag index pages (tags/tag-name.html):**
- Lists all notes with that tag
- Each entry shows note name + summary (if available)

**Graph page (graph.html):**
- Full-page interactive D3 force graph (same visualization as VS Code webview)
- Clicking a note node navigates to that note's page
- Clicking a tag node navigates to that tag's index page
- D3 library bundled inline (no CDN dependency — site works offline)

**Regeneration:** Running the command overwrites `_site/` entirely. This is generated output.

**Files:**
- Create: `src/siteExporter.ts` — orchestrates build (scan, render, generate pages, write files)
- Create: `resources/site-template/style.css` — wiki CSS theme
- Create: `resources/site-template/graph.js` — D3 force graph rendering script (shared with webview)
- Modify: `src/extension.ts` — register command
- Modify: `package.json` — register command

---

### 2. Knowledge Graph (VS Code Webview + Shared Renderer)

**Goal:** Visualize note relationships as an interactive force-directed graph inside VS Code.

**Command:** `ai-notes.showGraph` ("AI Notes: Show Knowledge Graph")

**UI:** Opens in a full webview editor panel (not sidebar — needs space for the graph).

**Visual style (Option B — Shape Differentiation):**
- **Note nodes:** Rounded rectangles, blue (#4a9eff), labeled with filename
- **Tag nodes:** Pill badges, green (#51cf66), labeled with tag name
- **Link edges:** Solid blue lines between notes that have markdown links to each other
- **Tag edges:** Green lines connecting notes to their tags
- **Node sizing:** Scales with connection count (more connections = larger node)

**Interactions:**
- Drag nodes to reposition
- Zoom and pan (mouse wheel + drag on background)
- Click a note node → opens that file in VS Code editor
- Click a tag node → no action (just visual anchor)
- Hover: show tooltip with note summary (if available)

**Force simulation:**
- Center force keeps graph centered
- Charge force (repulsion) between all nodes
- Link force (attraction) along edges
- Tags act as clustering anchors — notes sharing tags are pulled together

**Data model (JSON passed to renderer):**
```json
{
  "nodes": [
    { "id": "path/to/note.md", "type": "note", "label": "note.md", "summary": "...", "connections": 5 },
    { "id": "tag:meeting", "type": "tag", "label": "meeting", "connections": 8 }
  ],
  "edges": [
    { "source": "path/to/note.md", "target": "tag:meeting", "type": "tag" },
    { "source": "path/to/note.md", "target": "path/to/other.md", "type": "link" }
  ]
}
```

**Files:**
- Create: `src/graphData.ts` — scans workspace, builds nodes/edges JSON
- Create: `src/graphWebview.ts` — VS Code webview panel provider, embeds D3 renderer
- Modify: `src/extension.ts` — register command
- Modify: `package.json` — register command

---

## Shared Infrastructure

**Graph rendering code** (`resources/site-template/graph.js`):
- A single D3 force graph renderer that takes a `{ nodes, edges }` JSON object
- Used in two contexts:
  1. VS Code webview: embedded inline in the webview HTML, data passed as a script variable
  2. Static site: included as `js/graph.js`, data embedded as `window.graphData` in `graph.html`
- Renderer handles both contexts by reading data from `window.graphData`

**Existing code reused:**
- `marked` library (already a dependency) for markdown → HTML rendering
- `extractTagsFromContent` from `src/tagCache.ts`
- `extractMarkdownLinks` from `src/backlinksWebview.ts`
- `extractSummaryFromContent` from `src/summaries.ts`
- `gatherNotes` from `src/semanticSearch.ts`

**D3.js dependency:**
- Add `d3` as a dependency (`npm install d3`)
- Bundle the minified D3 force module into `resources/site-template/graph.js` for the static site
- For the webview: inline the D3 CDN script tag (webview has internet access) or bundle similarly

Actually, to keep things simple and offline-capable: bundle D3 as a vendored file at `resources/d3.min.js` and reference it in both the webview and the static site export. This avoids CDN dependencies and keeps the extension self-contained.

## Implementation Order

1. **Graph Data Module** — pure function that builds the nodes/edges JSON (needed by both features)
2. **Graph Renderer** — standalone D3 script that renders the force graph (shared asset)
3. **Knowledge Graph Webview** — VS Code panel using graph data + renderer
4. **Site Exporter** — generates the full static site including the graph page

This order ensures shared infrastructure is built first, then consumed by both features.

## New Dependency

- `d3` (npm package) — vendored as minified bundle for the webview and static site. Only the force simulation modules are needed: `d3-force`, `d3-selection`, `d3-zoom`, `d3-drag`.

Alternative: use `d3-force` standalone (much smaller) and handle SVG rendering manually. This avoids the full 250kb D3 bundle.

**Decision:** Use the full `d3` package for simplicity. The bundled output only goes into the webview and static site (not the extension bundle itself), so size is not a concern for VS Code marketplace limits.
