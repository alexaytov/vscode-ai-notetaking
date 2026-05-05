# Approach C2: Export & Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static wiki site exporter and an interactive D3 knowledge graph to the extension.

**Architecture:** A shared `graphData.ts` module builds the node/edge JSON from workspace notes. A standalone D3 renderer script (`resources/site-template/graph.js`) is used in both the VS Code graph webview and the exported static site. The site exporter converts markdown to HTML pages with sidebar navigation and backlinks.

**Tech Stack:** TypeScript, D3.js (vendored minified build), VS Code Webview API, `marked` (existing dependency), HTML/CSS templates.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/graphData.ts` (create) | Scans workspace, builds `{ nodes, edges }` JSON for the graph |
| `src/graphWebview.ts` (create) | VS Code webview panel that renders the D3 knowledge graph |
| `src/siteExporter.ts` (create) | Orchestrates static site generation (pages, indexes, assets) |
| `resources/site-template/style.css` (create) | Wiki CSS theme for the static site |
| `resources/site-template/graph.js` (create) | Standalone D3 force graph renderer (shared) |
| `resources/d3.min.js` (create) | Vendored D3 minified bundle |
| `src/extension.ts` (modify) | Register commands |
| `package.json` (modify) | Register commands, add d3 dev dependency |
| `src/test/graphData.test.ts` (create) | Unit tests for graph data building |
| `src/test/siteExporter.test.ts` (create) | Unit tests for link rewriting and page generation |

---

## Task 1: Install D3 and Vendor the Bundle

**Files:**
- Create: `resources/d3.min.js`
- Modify: `package.json`

- [ ] **Step 1: Install d3 as a dev dependency**

Run: `npm install --save-dev d3`

We only need it for vendoring, not at runtime (extension uses the vendored file).

- [ ] **Step 2: Copy the minified D3 bundle to resources**

Run: `cp node_modules/d3/dist/d3.min.js resources/d3.min.js`

- [ ] **Step 3: Verify the file exists and is reasonable size**

Run: `ls -la resources/d3.min.js`
Expected: File exists, ~250-280kb

- [ ] **Step 4: Commit**

```bash
git add resources/d3.min.js package.json package-lock.json
git commit -m "chore: vendor D3.js minified bundle for graph rendering"
```

---

## Task 2: Graph Data Module

**Files:**
- Create: `src/graphData.ts`
- Create: `src/test/graphData.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/graphData.test.ts`:

```typescript
import * as assert from 'assert';
import { buildGraphData, GraphData, GraphNode, GraphEdge } from '../graphData';

suite('GraphData', () => {
    test('buildGraphData returns empty graph for empty input', () => {
        const result = buildGraphData([]);
        assert.deepStrictEqual(result, { nodes: [], edges: [] });
    });

    test('buildGraphData creates note nodes', () => {
        const notes = [
            { filePath: '/workspace/note.md', tags: ['test'], links: [], summary: 'A summary' },
        ];
        const result = buildGraphData(notes);
        assert.strictEqual(result.nodes.length, 2); // 1 note + 1 tag
        const noteNode = result.nodes.find(n => n.type === 'note');
        assert.strictEqual(noteNode!.label, 'note.md');
        assert.strictEqual(noteNode!.summary, 'A summary');
    });

    test('buildGraphData creates tag nodes and edges', () => {
        const notes = [
            { filePath: '/workspace/a.md', tags: ['meeting', 'team'], links: [], summary: null },
        ];
        const result = buildGraphData(notes);
        const tagNodes = result.nodes.filter(n => n.type === 'tag');
        assert.strictEqual(tagNodes.length, 2);
        const tagEdges = result.edges.filter(e => e.type === 'tag');
        assert.strictEqual(tagEdges.length, 2);
    });

    test('buildGraphData creates link edges between notes', () => {
        const notes = [
            { filePath: '/workspace/a.md', tags: [], links: ['/workspace/b.md'], summary: null },
            { filePath: '/workspace/b.md', tags: [], links: [], summary: null },
        ];
        const result = buildGraphData(notes);
        const linkEdges = result.edges.filter(e => e.type === 'link');
        assert.strictEqual(linkEdges.length, 1);
        assert.strictEqual(linkEdges[0].source, '/workspace/a.md');
        assert.strictEqual(linkEdges[0].target, '/workspace/b.md');
    });

    test('buildGraphData deduplicates tag nodes across notes', () => {
        const notes = [
            { filePath: '/workspace/a.md', tags: ['shared'], links: [], summary: null },
            { filePath: '/workspace/b.md', tags: ['shared'], links: [], summary: null },
        ];
        const result = buildGraphData(notes);
        const tagNodes = result.nodes.filter(n => n.type === 'tag');
        assert.strictEqual(tagNodes.length, 1);
        assert.strictEqual(tagNodes[0].connections, 2);
    });
});
```

- [ ] **Step 2: Implement graphData module**

Create `src/graphData.ts`:

```typescript
import * as fsp from 'fs/promises';
import * as path from 'path';
import { extractTagsFromContent } from './tagCache';
import { extractMarkdownLinks } from './backlinksWebview';
import { extractSummaryFromContent } from './summaries';

export interface GraphNode {
    id: string;
    type: 'note' | 'tag';
    label: string;
    summary: string | null;
    connections: number;
}

export interface GraphEdge {
    source: string;
    target: string;
    type: 'tag' | 'link';
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export interface NoteGraphInput {
    filePath: string;
    tags: string[];
    links: string[];
    summary: string | null;
}

export function buildGraphData(notes: NoteGraphInput[]): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const tagNodeMap: Map<string, GraphNode> = new Map();
    const noteSet = new Set(notes.map(n => n.filePath));

    for (const note of notes) {
        const noteNode: GraphNode = {
            id: note.filePath,
            type: 'note',
            label: path.basename(note.filePath),
            summary: note.summary,
            connections: 0,
        };
        nodes.push(noteNode);

        for (const tag of note.tags) {
            const tagId = `tag:${tag}`;
            if (!tagNodeMap.has(tagId)) {
                const tagNode: GraphNode = {
                    id: tagId,
                    type: 'tag',
                    label: tag,
                    summary: null,
                    connections: 0,
                };
                tagNodeMap.set(tagId, tagNode);
                nodes.push(tagNode);
            }
            tagNodeMap.get(tagId)!.connections++;
            noteNode.connections++;
            edges.push({ source: note.filePath, target: tagId, type: 'tag' });
        }

        for (const linkTarget of note.links) {
            if (noteSet.has(linkTarget)) {
                noteNode.connections++;
                edges.push({ source: note.filePath, target: linkTarget, type: 'link' });
            }
        }
    }

    return { nodes, edges };
}

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', '.claude', '_drafts', '_site', '_moc']);

export async function scanWorkspaceForGraph(workspaceRoot: string): Promise<NoteGraphInput[]> {
    const notes: NoteGraphInput[] = [];
    await walkForGraph(workspaceRoot, workspaceRoot, notes);
    return notes;
}

async function walkForGraph(dir: string, workspaceRoot: string, notes: NoteGraphInput[]): Promise<void> {
    let entries;
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) { continue; }
            await walkForGraph(fullPath, workspaceRoot, notes);
        } else if (entry.name.endsWith('.md')) {
            try {
                const content = await fsp.readFile(fullPath, 'utf8');
                const tags = extractTagsFromContent(content);
                const markdownLinks = extractMarkdownLinks(content);
                const links = markdownLinks.map(l => path.resolve(path.dirname(fullPath), l.href));
                const summary = extractSummaryFromContent(content);
                notes.push({ filePath: fullPath, tags, links, summary });
            } catch {}
        }
    }
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/graphData.ts src/test/graphData.test.ts
git commit -m "feat: add graph data module for building node/edge JSON"
```

---

## Task 3: D3 Graph Renderer Script

**Files:**
- Create: `resources/site-template/graph.js`

- [ ] **Step 1: Create the shared D3 renderer**

Create `resources/site-template/graph.js`:

```javascript
// Shared D3 force graph renderer
// Reads data from window.graphData = { nodes: [...], edges: [...] }
// Renders into #graph-container

(function() {
    const data = window.graphData;
    if (!data || !data.nodes.length) {
        document.getElementById('graph-container').innerHTML = '<p style="text-align:center;opacity:0.6;">No graph data available.</p>';
        return;
    }

    const container = document.getElementById('graph-container');
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const svg = d3.select('#graph-container')
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    const g = svg.append('g');

    // Zoom
    const zoom = d3.zoom()
        .scaleExtent([0.2, 4])
        .on('zoom', function(event) {
            g.attr('transform', event.transform);
        });
    svg.call(zoom);

    // Force simulation
    const simulation = d3.forceSimulation(data.nodes)
        .force('link', d3.forceLink(data.edges).id(function(d) { return d.id; }).distance(80))
        .force('charge', d3.forceManyBody().strength(-200))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(30));

    // Edges
    const link = g.append('g')
        .selectAll('line')
        .data(data.edges)
        .join('line')
        .attr('stroke', function(d) { return d.type === 'tag' ? '#51cf66' : '#4a9eff'; })
        .attr('stroke-width', function(d) { return d.type === 'link' ? 2 : 1; })
        .attr('stroke-opacity', 0.5);

    // Note nodes (rounded rects)
    const noteNodes = g.append('g')
        .selectAll('g.note-node')
        .data(data.nodes.filter(function(d) { return d.type === 'note'; }))
        .join('g')
        .attr('class', 'note-node')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));

    noteNodes.append('rect')
        .attr('width', function(d) { return Math.max(60, d.label.length * 6 + 16); })
        .attr('height', 24)
        .attr('rx', 6)
        .attr('ry', 6)
        .attr('x', function(d) { return -Math.max(60, d.label.length * 6 + 16) / 2; })
        .attr('y', -12)
        .attr('fill', '#4a9eff')
        .attr('opacity', 0.8)
        .style('cursor', 'pointer');

    noteNodes.append('text')
        .text(function(d) { return d.label; })
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', 'white')
        .attr('font-size', '10px')
        .style('pointer-events', 'none');

    // Tag nodes (pills)
    const tagNodes = g.append('g')
        .selectAll('g.tag-node')
        .data(data.nodes.filter(function(d) { return d.type === 'tag'; }))
        .join('g')
        .attr('class', 'tag-node')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));

    tagNodes.append('rect')
        .attr('width', function(d) { return d.label.length * 7 + 14; })
        .attr('height', 18)
        .attr('rx', 9)
        .attr('ry', 9)
        .attr('x', function(d) { return -(d.label.length * 7 + 14) / 2; })
        .attr('y', -9)
        .attr('fill', '#51cf66')
        .attr('opacity', 0.7);

    tagNodes.append('text')
        .text(function(d) { return d.label; })
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', 'white')
        .attr('font-size', '9px')
        .style('pointer-events', 'none');

    // Tooltip
    const tooltip = d3.select('body').append('div')
        .style('position', 'absolute')
        .style('padding', '6px 10px')
        .style('background', 'rgba(0,0,0,0.8)')
        .style('color', 'white')
        .style('border-radius', '4px')
        .style('font-size', '12px')
        .style('pointer-events', 'none')
        .style('opacity', 0);

    noteNodes.on('mouseenter', function(event, d) {
        const text = d.summary || d.label;
        tooltip.text(text).style('opacity', 1);
    }).on('mousemove', function(event) {
        tooltip.style('left', (event.pageX + 10) + 'px').style('top', (event.pageY - 20) + 'px');
    }).on('mouseleave', function() {
        tooltip.style('opacity', 0);
    });

    // Click handler
    noteNodes.on('click', function(event, d) {
        if (window.vscodeApi) {
            window.vscodeApi.postMessage({ command: 'openNote', path: d.id });
        } else if (window.graphNavBase) {
            window.location.href = window.graphNavBase + encodeURIComponent(d.label.replace('.md', '.html'));
        }
    });

    // Tick
    simulation.on('tick', function() {
        link
            .attr('x1', function(d) { return d.source.x; })
            .attr('y1', function(d) { return d.source.y; })
            .attr('x2', function(d) { return d.target.x; })
            .attr('y2', function(d) { return d.target.y; });

        noteNodes.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
        tagNodes.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
    });

    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }
})();
```

- [ ] **Step 2: Create the CSS template**

Create `resources/site-template/style.css`:

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; background: #fafafa; }
.layout { display: flex; min-height: 100vh; }
.sidebar { width: 250px; background: #f0f0f0; border-right: 1px solid #ddd; padding: 20px; overflow-y: auto; position: sticky; top: 0; height: 100vh; }
.sidebar h3 { font-size: 0.85em; text-transform: uppercase; color: #666; margin: 16px 0 8px; }
.sidebar ul { list-style: none; }
.sidebar li { margin: 2px 0; }
.sidebar a { color: #333; text-decoration: none; font-size: 0.9em; }
.sidebar a:hover { color: #4a9eff; }
.main { flex: 1; padding: 40px; max-width: 800px; }
.main h1 { margin-bottom: 8px; }
.main h2 { margin-top: 24px; margin-bottom: 8px; }
.main h3 { margin-top: 16px; margin-bottom: 4px; }
.main p { margin-bottom: 12px; }
.main ul, .main ol { margin-left: 20px; margin-bottom: 12px; }
.main a { color: #4a9eff; }
.main code { background: #eee; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
.main pre { background: #282c34; color: #abb2bf; padding: 16px; border-radius: 6px; overflow-x: auto; margin-bottom: 16px; }
.main pre code { background: none; padding: 0; color: inherit; }
.main img { max-width: 100%; height: auto; }
.backlinks { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; }
.backlinks h3 { font-size: 0.9em; color: #666; }
.tag-cloud { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
.tag-cloud a { background: #e8f4fd; color: #4a9eff; padding: 4px 10px; border-radius: 12px; font-size: 0.85em; text-decoration: none; }
.tag-cloud a:hover { background: #4a9eff; color: white; }
.note-list { list-style: none; }
.note-list li { padding: 8px 0; border-bottom: 1px solid #eee; }
.note-list .summary { font-size: 0.85em; color: #666; }
#graph-container { width: 100%; height: 80vh; }
```

- [ ] **Step 3: Commit**

```bash
mkdir -p resources/site-template
git add resources/site-template/graph.js resources/site-template/style.css
git commit -m "feat: add shared D3 graph renderer and wiki CSS template"
```

---

## Task 4: Knowledge Graph Webview

**Files:**
- Create: `src/graphWebview.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the graph webview provider**

Create `src/graphWebview.ts`:

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { scanWorkspaceForGraph, buildGraphData } from './graphData';

export class GraphWebviewProvider {
    private panel?: vscode.WebviewPanel;

    constructor(
        private workspaceRoot: string,
        private extensionPath: string
    ) {}

    async show(): Promise<void> {
        if (this.panel) {
            this.panel.reveal();
            await this.update();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'aiNotesGraph',
            'Knowledge Graph',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        this.panel.onDidDispose(() => { this.panel = undefined; });

        this.panel.webview.onDidReceiveMessage(message => {
            if (message.command === 'openNote') {
                const uri = vscode.Uri.file(message.path);
                vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
            }
        });

        await this.update();
    }

    private async update(): Promise<void> {
        if (!this.panel) { return; }

        const notes = await scanWorkspaceForGraph(this.workspaceRoot);
        const graphData = buildGraphData(notes);

        const d3Path = path.join(this.extensionPath, 'resources', 'd3.min.js');
        const graphJsPath = path.join(this.extensionPath, 'resources', 'site-template', 'graph.js');

        const d3Script = fs.readFileSync(d3Path, 'utf8');
        const graphScript = fs.readFileSync(graphJsPath, 'utf8');

        this.panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<style>
    body { margin: 0; padding: 0; background: #1e1e1e; overflow: hidden; }
    #graph-container { width: 100vw; height: 100vh; }
</style>
</head>
<body>
    <div id="graph-container"></div>
    <script>window.vscodeApi = acquireVsCodeApi();</script>
    <script>${d3Script}</script>
    <script>window.graphData = ${JSON.stringify(graphData)};</script>
    <script>${graphScript}</script>
</body>
</html>`;
    }
}
```

- [ ] **Step 2: Add command to package.json**

In `contributes.commands` array, add:

```json
{
    "command": "ai-notes.showGraph",
    "title": "AI Notes: Show Knowledge Graph"
}
```

- [ ] **Step 3: Register command in extension.ts**

Add import at top:
```typescript
import { GraphWebviewProvider } from './graphWebview';
```

Add command registration after the `generateMOCDisposable` block:

```typescript
    // Knowledge graph command
    let graphProvider: GraphWebviewProvider | undefined;
    const showGraphDisposable = vscode.commands.registerCommand('ai-notes.showGraph', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }
        if (!graphProvider) {
            graphProvider = new GraphWebviewProvider(workspaceFolders[0].uri.fsPath, context.extensionPath);
        }
        await graphProvider.show();
    });
    context.subscriptions.push(showGraphDisposable);
```

- [ ] **Step 4: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/graphWebview.ts src/extension.ts package.json
git commit -m "feat: add knowledge graph webview with D3 force layout"
```

---

## Task 5: Site Exporter — Core Module

**Files:**
- Create: `src/siteExporter.ts`
- Create: `src/test/siteExporter.test.ts`

- [ ] **Step 1: Write failing tests for link rewriting**

Create `src/test/siteExporter.test.ts`:

```typescript
import * as assert from 'assert';
import { rewriteMarkdownLinks, generateSlug } from '../siteExporter';

suite('SiteExporter', () => {
    test('rewriteMarkdownLinks converts .md to .html paths', () => {
        const md = 'See [my note](./other-note.md) for details.';
        const result = rewriteMarkdownLinks(md);
        assert.strictEqual(result, 'See [my note](../notes/other-note.html) for details.');
    });

    test('rewriteMarkdownLinks handles nested paths', () => {
        const md = 'See [ref](../docs/ref.md) for details.';
        const result = rewriteMarkdownLinks(md);
        assert.strictEqual(result, 'See [ref](../notes/ref.html) for details.');
    });

    test('rewriteMarkdownLinks ignores absolute URLs', () => {
        const md = 'See [docs](https://example.com/page.md).';
        const result = rewriteMarkdownLinks(md);
        assert.strictEqual(result, 'See [docs](https://example.com/page.md).');
    });

    test('generateSlug creates url-safe slugs', () => {
        assert.strictEqual(generateSlug('Hello World'), 'hello-world');
        assert.strictEqual(generateSlug('C++ Notes!'), 'c-notes');
    });
});
```

- [ ] **Step 2: Implement site exporter module**

Create `src/siteExporter.ts`:

```typescript
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { marked } from 'marked';
import { extractTagsFromContent } from './tagCache';
import { extractSummaryFromContent } from './summaries';
import { extractMarkdownLinks } from './backlinksWebview';
import { scanWorkspaceForGraph, buildGraphData } from './graphData';

interface SiteNote {
    filePath: string;
    fileName: string;
    slug: string;
    tags: string[];
    summary: string | null;
    content: string;
    backlinks: string[];
}

export function rewriteMarkdownLinks(md: string): string {
    return md.replace(/\[([^\]]*)\]\(([^)]+\.md)\)/g, (match, text, href) => {
        if (/^https?:\/\//.test(href)) { return match; }
        const basename = path.basename(href, '.md');
        return `[${text}](../notes/${basename}.html)`;
    });
}

export function generateSlug(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

export async function exportSite(workspaceRoot: string, extensionPath: string): Promise<string> {
    const siteDir = path.join(workspaceRoot, '_site');

    // Clean and create directories
    if (fs.existsSync(siteDir)) {
        await fsp.rm(siteDir, { recursive: true });
    }
    fs.mkdirSync(path.join(siteDir, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'tags'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'css'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'js'), { recursive: true });

    // Copy assets
    const styleSrc = path.join(extensionPath, 'resources', 'site-template', 'style.css');
    await fsp.copyFile(styleSrc, path.join(siteDir, 'css', 'style.css'));

    const d3Src = path.join(extensionPath, 'resources', 'd3.min.js');
    await fsp.copyFile(d3Src, path.join(siteDir, 'js', 'd3.min.js'));

    const graphJsSrc = path.join(extensionPath, 'resources', 'site-template', 'graph.js');
    await fsp.copyFile(graphJsSrc, path.join(siteDir, 'js', 'graph.js'));

    // Gather notes
    const notes = await gatherSiteNotes(workspaceRoot);
    const allTags = collectTags(notes);

    // Build backlinks
    for (const note of notes) {
        note.backlinks = findBacklinks(note, notes);
    }

    // Generate note pages
    for (const note of notes) {
        const html = renderNotePage(note, allTags, notes);
        await fsp.writeFile(path.join(siteDir, 'notes', `${note.slug}.html`), html, 'utf8');
    }

    // Generate tag pages
    for (const [tag, tagNotes] of Object.entries(allTags)) {
        const html = renderTagPage(tag, tagNotes, allTags);
        await fsp.writeFile(path.join(siteDir, 'tags', `${generateSlug(tag)}.html`), html, 'utf8');
    }

    // Generate index
    const indexHtml = renderIndexPage(notes, allTags);
    await fsp.writeFile(path.join(siteDir, 'index.html'), indexHtml, 'utf8');

    // Generate graph page
    const graphNotes = await scanWorkspaceForGraph(workspaceRoot);
    const graphData = buildGraphData(graphNotes);
    const graphHtml = renderGraphPage(graphData, allTags);
    await fsp.writeFile(path.join(siteDir, 'graph.html'), graphHtml, 'utf8');

    return siteDir;
}

async function gatherSiteNotes(workspaceRoot: string): Promise<SiteNote[]> {
    const notes: SiteNote[] = [];
    await walkSite(workspaceRoot, workspaceRoot, notes);
    return notes;
}

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', '.claude', '_drafts', '_site', '_moc', '.ai-notes', '.templates']);

async function walkSite(dir: string, workspaceRoot: string, notes: SiteNote[]): Promise<void> {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) { continue; }
            await walkSite(fullPath, workspaceRoot, notes);
        } else if (entry.name.endsWith('.md')) {
            try {
                const raw = await fsp.readFile(fullPath, 'utf8');
                const tags = extractTagsFromContent(raw);
                const summary = extractSummaryFromContent(raw);
                const content = raw.replace(/^---\n(?:.*\n)*?---\n/, '');
                const slug = path.basename(fullPath, '.md');
                notes.push({ filePath: fullPath, fileName: entry.name, slug, tags, summary, content, backlinks: [] });
            } catch {}
        }
    }
}

function collectTags(notes: SiteNote[]): Record<string, SiteNote[]> {
    const tags: Record<string, SiteNote[]> = {};
    for (const note of notes) {
        for (const tag of note.tags) {
            if (!tags[tag]) { tags[tag] = []; }
            tags[tag].push(note);
        }
    }
    return tags;
}

function findBacklinks(target: SiteNote, allNotes: SiteNote[]): string[] {
    const backlinks: string[] = [];
    for (const note of allNotes) {
        if (note.filePath === target.filePath) { continue; }
        const links = extractMarkdownLinks(note.content);
        for (const link of links) {
            const resolved = path.resolve(path.dirname(note.filePath), link.href);
            if (resolved === target.filePath) {
                backlinks.push(note.slug);
                break;
            }
        }
    }
    return backlinks;
}

function sidebarHtml(allTags: Record<string, SiteNote[]>): string {
    const tagLinks = Object.keys(allTags).sort().map(tag =>
        `<li><a href="../tags/${generateSlug(tag)}.html">${tag} (${allTags[tag].length})</a></li>`
    ).join('\n');
    return `<div class="sidebar">
        <h3>Navigation</h3>
        <ul><li><a href="../index.html">Home</a></li><li><a href="../graph.html">Graph</a></li></ul>
        <h3>Tags</h3>
        <ul>${tagLinks}</ul>
    </div>`;
}

function renderNotePage(note: SiteNote, allTags: Record<string, SiteNote[]>, allNotes: SiteNote[]): string {
    const rewritten = rewriteMarkdownLinks(note.content);
    const htmlContent = marked(rewritten) as string;
    const backlinksHtml = note.backlinks.length > 0
        ? `<div class="backlinks"><h3>Backlinks</h3><ul>${note.backlinks.map(s => `<li><a href="${s}.html">${s}</a></li>`).join('')}</ul></div>`
        : '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${note.slug}</title><link rel="stylesheet" href="../css/style.css"></head><body>
<div class="layout">${sidebarHtml(allTags)}<div class="main"><h1>${note.slug}</h1>${htmlContent}${backlinksHtml}</div></div></body></html>`;
}

function renderTagPage(tag: string, tagNotes: SiteNote[], allTags: Record<string, SiteNote[]>): string {
    const noteList = tagNotes.map(n =>
        `<li><a href="../notes/${n.slug}.html">${n.fileName}</a>${n.summary ? `<span class="summary"> — ${n.summary}</span>` : ''}</li>`
    ).join('\n');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tag: ${tag}</title><link rel="stylesheet" href="../css/style.css"></head><body>
<div class="layout">${sidebarHtml(allTags)}<div class="main"><h1>Tag: ${tag}</h1><ul class="note-list">${noteList}</ul></div></div></body></html>`;
}

function renderIndexPage(notes: SiteNote[], allTags: Record<string, SiteNote[]>): string {
    const recent = notes.slice(0, 10);
    const recentList = recent.map(n =>
        `<li><a href="notes/${n.slug}.html">${n.fileName}</a>${n.summary ? `<span class="summary"> — ${n.summary}</span>` : ''}</li>`
    ).join('\n');
    const tagCloud = Object.keys(allTags).sort().map(tag =>
        `<a href="tags/${generateSlug(tag)}.html">${tag}</a>`
    ).join('\n');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Notes Wiki</title><link rel="stylesheet" href="css/style.css"></head><body>
<div class="layout"><div class="sidebar"><h3>Navigation</h3><ul><li><a href="index.html">Home</a></li><li><a href="graph.html">Graph</a></li></ul>
<h3>Tags</h3><ul>${Object.keys(allTags).sort().map(t => `<li><a href="tags/${generateSlug(t)}.html">${t} (${allTags[t].length})</a></li>`).join('')}</ul></div>
<div class="main"><h1>Notes Wiki</h1><h2>Recent Notes</h2><ul class="note-list">${recentList}</ul><h2>Tags</h2><div class="tag-cloud">${tagCloud}</div></div></div></body></html>`;
}

function renderGraphPage(graphData: any, allTags: Record<string, SiteNote[]>): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Knowledge Graph</title><link rel="stylesheet" href="css/style.css"></head><body>
<div class="layout">${sidebarHtml(allTags).replace(/\.\.\//g, '')}<div class="main" style="max-width:none;padding:20px;">
<h1>Knowledge Graph</h1><div id="graph-container"></div>
<script src="js/d3.min.js"></script>
<script>window.graphData = ${JSON.stringify(graphData)}; window.graphNavBase = 'notes/';</script>
<script src="js/graph.js"></script>
</div></div></body></html>`;
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/siteExporter.ts src/test/siteExporter.test.ts
git commit -m "feat: add static wiki site exporter with pages, tags, and graph"
```

---

## Task 6: Site Exporter — Register Command

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Add command to package.json**

In `contributes.commands` array, add:

```json
{
    "command": "ai-notes.exportSite",
    "title": "AI Notes: Export as Static Site"
}
```

- [ ] **Step 2: Register command in extension.ts**

Add import at top:
```typescript
import { exportSite } from './siteExporter';
```

Add command registration after the `showGraphDisposable` block:

```typescript
    // Export static site command
    const exportSiteDisposable = vscode.commands.registerCommand('ai-notes.exportSite', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }

        try {
            const siteDir = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Exporting static site...' },
                () => exportSite(workspaceFolders[0].uri.fsPath, context.extensionPath)
            );
            const indexUri = vscode.Uri.file(path.join(siteDir, 'index.html'));
            await vscode.window.showTextDocument(indexUri);
            vscode.window.showInformationMessage(`Static site exported to _site/`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Site export failed: ${err.message}`);
        }
    });
    context.subscriptions.push(exportSiteDisposable);
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: register static site export command"
```

---

## Summary

| Task | Feature | Effort |
|------|---------|--------|
| 1 | Vendor D3.js | Trivial |
| 2 | Graph data module | Medium |
| 3 | D3 renderer + CSS template | Medium |
| 4 | Knowledge graph webview | Medium |
| 5 | Site exporter core | Large |
| 6 | Site export command | Small |

Total: 6 focused tasks, each independently committable and testable.
