# Approach B: Smarter Discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI summaries, semantic search, related notes, and smart collections to make notes discoverable by meaning, not just tags.

**Architecture:** All features use the existing `chatCompletionWithRetry` AI pipeline (which must be exported). Summaries are stored in YAML frontmatter. Semantic search and related notes send note summaries to AI for ranking. Collections are persisted as JSON in `.ai-notes/collections.json`.

**Tech Stack:** TypeScript, VS Code Extension API, existing AI pipeline (VS Code LM API / SAP AI Core), JSON file storage for collections.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/ai.ts` (modify) | Export `chatCompletionWithRetry` for use by other modules |
| `src/summaries.ts` (create) | Generate one-line summaries via AI, extract summaries from frontmatter |
| `src/semanticSearch.ts` (create) | Gather note summaries, query AI for ranked matches, show QuickPick |
| `src/relatedNotesWebview.ts` (create) | Two-stage related notes (tag overlap + AI ranking) webview |
| `src/smartCollections.ts` (create) | Collection CRUD, filter logic, QuickPick UI |
| `src/notesByTagWebview.ts` (modify) | Display summaries below note names |
| `src/extension.ts` (modify) | Register commands and webview |
| `package.json` (modify) | Register commands and webview view |
| `src/test/summaries.test.ts` (create) | Unit tests for summary extraction |
| `src/test/semanticSearch.test.ts` (create) | Unit tests for note gathering and result parsing |
| `src/test/smartCollections.test.ts` (create) | Unit tests for collection filtering |

---

## Task 1: Export chatCompletionWithRetry from ai.ts

**Files:**
- Modify: `src/ai.ts`

- [ ] **Step 1: Export the function**

In `src/ai.ts`, change line 103 from:
```typescript
async function chatCompletionWithRetry(prompt: string, retries = 3): Promise<string> {
```
To:
```typescript
export async function chatCompletionWithRetry(prompt: string, retries = 3): Promise<string> {
```

- [ ] **Step 2: Verify no type errors**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/ai.ts
git commit -m "refactor: export chatCompletionWithRetry for use by other modules"
```

---

## Task 2: AI Summaries — Core Module

**Files:**
- Create: `src/summaries.ts`
- Create: `src/test/summaries.test.ts`

- [ ] **Step 1: Write failing tests for summary extraction from frontmatter**

Create `src/test/summaries.test.ts`:

```typescript
import * as assert from 'assert';
import { extractSummaryFromContent } from '../summaries';

suite('Summaries', () => {
    test('extracts summary from frontmatter', () => {
        const content = '---\ntags: [test]\nsummary: "This is a test note"\n---\n# Hello';
        const summary = extractSummaryFromContent(content);
        assert.strictEqual(summary, 'This is a test note');
    });

    test('returns null when no summary in frontmatter', () => {
        const content = '---\ntags: [test]\n---\n# Hello';
        const summary = extractSummaryFromContent(content);
        assert.strictEqual(summary, null);
    });

    test('returns null when no frontmatter', () => {
        const content = '# Hello\nSome content';
        const summary = extractSummaryFromContent(content);
        assert.strictEqual(summary, null);
    });

    test('handles summary without quotes', () => {
        const content = '---\nsummary: This is unquoted\n---\n';
        const summary = extractSummaryFromContent(content);
        assert.strictEqual(summary, 'This is unquoted');
    });

    test('truncates long summaries to 80 chars', () => {
        const long = 'A'.repeat(100);
        const content = `---\nsummary: "${long}"\n---\n`;
        const summary = extractSummaryFromContent(content);
        assert.strictEqual(summary!.length, 80);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run check-types`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement summaries module**

Create `src/summaries.ts`:

```typescript
import { chatCompletionWithRetry } from './ai';

export function extractSummaryFromContent(content: string): string | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) { return null; }
    const yaml = match[1];
    const summaryLine = yaml.split('\n').find(line => line.trim().startsWith('summary:'));
    if (!summaryLine) { return null; }
    const valueMatch = summaryLine.match(/^summary:\s*"?([^"]*)"?\s*$/);
    if (!valueMatch || !valueMatch[1]) { return null; }
    const raw = valueMatch[1].trim();
    return raw.length > 80 ? raw.slice(0, 80) : raw;
}

export async function generateSummary(content: string): Promise<string> {
    const prompt = `Summarize this note in one concise sentence (max 15 words). Output only the summary, no quotes or extra formatting.

Note content:
"""${content}"""`;

    const response = await chatCompletionWithRetry(prompt);
    return response.trim().replace(/^["']|["']$/g, '');
}
```

- [ ] **Step 4: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/summaries.ts src/test/summaries.test.ts
git commit -m "feat: add AI summary generation and extraction module"
```

---

## Task 3: AI Summaries — Register Command

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Add command to package.json**

In `package.json`, in the `contributes.commands` array, add:

```json
{
    "command": "ai-notes.generateSummary",
    "title": "AI Notes: Generate Summary"
}
```

- [ ] **Step 2: Register command in extension.ts**

Add import at top of `src/extension.ts`:
```typescript
import { generateSummary } from './summaries';
```

Add command registration inside `activate()`, after the `revealInFinderDisposable` block:

```typescript
    // Generate summary command
    const generateSummaryDisposable = vscode.commands.registerCommand('ai-notes.generateSummary', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.md')) {
            vscode.window.showErrorMessage('No Markdown file open.');
            return;
        }

        const doc = editor.document;
        const content = doc.getText();
        const yamlRegex = /^---\n(?:.*\n)*?---\n/;
        const cleanedContent = content.replace(yamlRegex, '');

        if (cleanedContent.trim().length === 0) {
            vscode.window.showErrorMessage('Note has no content to summarize.');
            return;
        }

        try {
            const summary = await generateSummary(cleanedContent);
            await upsertFrontmatterKey(doc, 'summary', `"${summary}"`);
            vscode.window.showInformationMessage(`Summary generated: ${summary}`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Summary generation failed: ${err.message}`);
        }
    });
    context.subscriptions.push(generateSummaryDisposable);
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: register generate summary command"
```

---

## Task 4: AI Summaries — Display in Tag Browser

**Files:**
- Modify: `src/notesByTagWebview.ts`

- [ ] **Step 1: Extract summary during tag scan**

In `src/notesByTagWebview.ts`, change the `getNotesByTag` method's return type and data structure. Currently it returns `Record<string, string[]>` (tag -> array of file paths). Change to include summaries:

Change the method signature from:
```typescript
private async getNotesByTag(filter: string): Promise<Record<string, string[]>> {
    const notesByTag: Record<string, string[]> = {};
```
To:
```typescript
private async getNotesByTag(filter: string): Promise<Record<string, Array<{ path: string; summary: string | null }>>> {
    const notesByTag: Record<string, Array<{ path: string; summary: string | null }>> = {};
```

In the inner loop where tags are matched, change:
```typescript
if (!notesByTag[tag]) { notesByTag[tag] = []; }
notesByTag[tag].push(fullPath);
```
To:
```typescript
if (!notesByTag[tag]) { notesByTag[tag] = []; }
const summaryLine = yaml.split('\n').find(line => line.trim().startsWith('summary:'));
let summary: string | null = null;
if (summaryLine) {
    const sMatch = summaryLine.match(/^summary:\s*"?([^"]*)"?\s*$/);
    if (sMatch && sMatch[1]) { summary = sMatch[1].trim(); }
}
notesByTag[tag].push({ path: fullPath, summary });
```

- [ ] **Step 2: Update getHtmlForWebview to accept new data shape**

Change the `getHtmlForWebview` method signature from:
```typescript
private getHtmlForWebview(notesByTag: Record<string, string[]>, filter: string): string {
```
To:
```typescript
private getHtmlForWebview(notesByTag: Record<string, Array<{ path: string; summary: string | null }>>, filter: string): string {
```

Update the initial call in `resolveWebviewView`:
```typescript
webviewView.webview.html = this.getHtmlForWebview({}, '');
```
This stays the same (empty object still works).

Update the note template inside `getHtmlForWebview`. Change:
```typescript
${notesByTag[tag].map(note => `
    <div class="note" data-path="${escapeHtml(note)}"><input type="checkbox" class="note-checkbox" data-path="${escapeHtml(note)}" />${escapeHtml(path.basename(note))}</div>
`).join('')}
```
To:
```typescript
${notesByTag[tag].map(note => `
    <div class="note" data-path="${escapeHtml(note.path)}"><input type="checkbox" class="note-checkbox" data-path="${escapeHtml(note.path)}" />${escapeHtml(path.basename(note.path))}${note.summary ? `<div class="note-summary">${escapeHtml(note.summary.length > 80 ? note.summary.slice(0, 80) + '...' : note.summary)}</div>` : ''}</div>
`).join('')}
```

- [ ] **Step 3: Add CSS for summary display**

In the `<style>` block, add:
```css
.note-summary {
    font-size: 0.85em;
    opacity: 0.7;
    margin-left: 1.5em;
    margin-top: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
```

- [ ] **Step 4: Update the message handler and click handlers**

The `bulkReclassify` message handler sends `message.paths` — these come from the checkbox `data-path` attributes which now use `note.path`, so they still send the correct file paths. No change needed.

- [ ] **Step 5: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/notesByTagWebview.ts
git commit -m "feat: display note summaries in tag browser"
```

---

## Task 5: Semantic Search — Core Module

**Files:**
- Create: `src/semanticSearch.ts`
- Create: `src/test/semanticSearch.test.ts`

- [ ] **Step 1: Write failing tests for note gathering and result parsing**

Create `src/test/semanticSearch.test.ts`:

```typescript
import * as assert from 'assert';
import { parseSearchResults, buildNoteEntry } from '../semanticSearch';

suite('SemanticSearch', () => {
    test('parseSearchResults extracts indices from JSON array', () => {
        const response = '[3, 1, 7, 2]';
        const indices = parseSearchResults(response);
        assert.deepStrictEqual(indices, [3, 1, 7, 2]);
    });

    test('parseSearchResults handles messy AI output', () => {
        const response = 'Here are the results: [5, 2, 8]\nHope that helps!';
        const indices = parseSearchResults(response);
        assert.deepStrictEqual(indices, [5, 2, 8]);
    });

    test('parseSearchResults returns empty on invalid output', () => {
        const response = 'I cannot determine relevance.';
        const indices = parseSearchResults(response);
        assert.deepStrictEqual(indices, []);
    });

    test('buildNoteEntry uses summary when available', () => {
        const entry = buildNoteEntry('/path/to/note.md', 'This is the summary');
        assert.strictEqual(entry, 'note.md — This is the summary');
    });

    test('buildNoteEntry uses content snippet when no summary', () => {
        const content = 'A'.repeat(150);
        const entry = buildNoteEntry('/path/to/note.md', null, content);
        assert.strictEqual(entry.length, 'note.md — '.length + 100);
    });
});
```

- [ ] **Step 2: Implement semantic search module**

Create `src/semanticSearch.ts`:

```typescript
import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { chatCompletionWithRetry } from './ai';
import { extractSummaryFromContent } from './summaries';

export interface NoteInfo {
    filePath: string;
    summary: string | null;
    snippet: string;
}

export function parseSearchResults(response: string): number[] {
    const match = response.match(/\[[\d,\s]+\]/);
    if (!match) { return []; }
    try {
        const arr = JSON.parse(match[0]);
        if (Array.isArray(arr) && arr.every(n => typeof n === 'number')) {
            return arr;
        }
    } catch {}
    return [];
}

export function buildNoteEntry(filePath: string, summary: string | null, content?: string): string {
    const name = path.basename(filePath);
    if (summary) {
        return `${name} — ${summary}`;
    }
    const snippet = (content || '').slice(0, 100);
    return `${name} — ${snippet}`;
}

export async function gatherNotes(workspaceRoot: string): Promise<NoteInfo[]> {
    const notes: NoteInfo[] = [];
    await walk(workspaceRoot, notes);
    return notes;
}

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', '.claude', '_drafts']);

async function walk(dir: string, notes: NoteInfo[]): Promise<void> {
    let entries;
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) { continue; }
            await walk(fullPath, notes);
        } else if (entry.name.endsWith('.md')) {
            try {
                const content = await fsp.readFile(fullPath, 'utf8');
                const yamlRegex = /^---\n(?:.*\n)*?---\n/;
                const cleanedContent = content.replace(yamlRegex, '');
                const summary = extractSummaryFromContent(content);
                notes.push({
                    filePath: fullPath,
                    summary,
                    snippet: cleanedContent.slice(0, 100),
                });
            } catch {}
        }
    }
}

export async function searchNotes(query: string, notes: NoteInfo[]): Promise<string[]> {
    const BATCH_SIZE = 50;
    const allIndices: Array<{ index: number; batchOffset: number }> = [];

    for (let i = 0; i < notes.length; i += BATCH_SIZE) {
        const batch = notes.slice(i, i + BATCH_SIZE);
        const noteList = batch.map((n, idx) => {
            const display = buildNoteEntry(n.filePath, n.summary, n.snippet);
            return `${idx + 1}. ${display}`;
        }).join('\n');

        const prompt = `You are a note search assistant. Given the search query and a list of notes with their summaries, return the indices of the most relevant notes (up to 10), ranked by relevance.

Query: "${query}"

Notes:
${noteList}

Respond with ONLY a JSON array of indices, e.g. [3, 7, 1]. No other text.`;

        try {
            const response = await chatCompletionWithRetry(prompt);
            const indices = parseSearchResults(response);
            for (const idx of indices) {
                if (idx >= 1 && idx <= batch.length) {
                    allIndices.push({ index: idx - 1 + i, batchOffset: allIndices.length });
                }
            }
        } catch {}
    }

    return allIndices.slice(0, 10).map(item => notes[item.index].filePath);
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/semanticSearch.ts src/test/semanticSearch.test.ts
git commit -m "feat: add semantic search module with AI-powered ranking"
```

---

## Task 6: Semantic Search — Register Command

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Add command to package.json**

In `package.json`, in the `contributes.commands` array, add:

```json
{
    "command": "ai-notes.semanticSearch",
    "title": "AI Notes: Search Notes"
}
```

- [ ] **Step 2: Register command in extension.ts**

Add import at top:
```typescript
import { gatherNotes, searchNotes } from './semanticSearch';
```

Add command registration inside `activate()`, after the `generateSummaryDisposable` block:

```typescript
    // Semantic search command
    const semanticSearchDisposable = vscode.commands.registerCommand('ai-notes.semanticSearch', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }

        const query = await vscode.window.showInputBox({
            prompt: 'What are you looking for?',
            placeHolder: 'Search your notes by meaning...',
        });
        if (!query) { return; }

        const rootDir = workspaceFolders[0].uri.fsPath;

        const results = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Searching notes...' },
            async () => {
                const notes = await gatherNotes(rootDir);
                return searchNotes(query, notes);
            }
        );

        if (results.length === 0) {
            vscode.window.showInformationMessage('No matching notes found.');
            return;
        }

        const items = results.map(filePath => ({
            label: path.basename(filePath),
            description: path.relative(rootDir, filePath),
            detail: filePath,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Found ${items.length} matching notes`,
        });
        if (selected) {
            const uri = vscode.Uri.file(selected.detail!);
            await vscode.window.showTextDocument(uri);
        }
    });
    context.subscriptions.push(semanticSearchDisposable);
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: register semantic search command with QuickPick results"
```

---

## Task 7: Related Notes — Webview Provider

**Files:**
- Create: `src/relatedNotesWebview.ts`

- [ ] **Step 1: Implement the related notes webview**

Create `src/relatedNotesWebview.ts`:

```typescript
import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { extractTagsFromContent, TagCache } from './tagCache';
import { extractSummaryFromContent } from './summaries';
import { chatCompletionWithRetry } from './ai';

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

interface RelatedNote {
    filePath: string;
    summary: string | null;
    score: number;
}

export class RelatedNotesWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiNotesRelatedWebView';
    private view?: vscode.WebviewView;
    private disposables: vscode.Disposable[] = [];
    private debounceTimer?: NodeJS.Timeout;

    constructor(
        private workspaceRoot: string,
        private tagCache: TagCache
    ) {}

    initialize(): void {
        vscode.window.onDidChangeActiveTextEditor(() => {
            if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
            this.debounceTimer = setTimeout(() => this.refresh(), 500);
        }, null, this.disposables);
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };

        webviewView.webview.onDidReceiveMessage(message => {
            if (message.command === 'openNote') {
                const uri = vscode.Uri.file(message.path);
                vscode.window.showTextDocument(uri);
            }
        });

        this.refresh();
    }

    private async refresh(): Promise<void> {
        if (!this.view) { return; }
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.md')) {
            this.view.webview.html = this.getHtml([]);
            return;
        }

        const currentFile = editor.document.uri.fsPath;
        const content = editor.document.getText();
        const currentTags = extractTagsFromContent(content);
        const currentSummary = extractSummaryFromContent(content);

        if (currentTags.length === 0) {
            this.view.webview.html = this.getHtml([]);
            return;
        }

        const candidates = await this.findByTagOverlap(currentFile, currentTags);

        let ranked: RelatedNote[];
        if (currentSummary && candidates.some(c => c.summary !== null)) {
            ranked = await this.aiRank(currentSummary, candidates);
        } else {
            ranked = candidates.slice(0, 5);
        }

        this.view.webview.html = this.getHtml(ranked);
    }

    private async findByTagOverlap(currentFile: string, currentTags: string[]): Promise<RelatedNote[]> {
        const candidates: Map<string, RelatedNote> = new Map();
        await this.walkForCandidates(this.workspaceRoot, currentFile, currentTags, candidates);

        return Array.from(candidates.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
    }

    private static readonly EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', '.claude', '_drafts']);

    private async walkForCandidates(
        dir: string,
        currentFile: string,
        currentTags: string[],
        candidates: Map<string, RelatedNote>
    ): Promise<void> {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch { return; }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (RelatedNotesWebviewProvider.EXCLUDED_DIRS.has(entry.name)) { continue; }
                await this.walkForCandidates(fullPath, currentFile, currentTags, candidates);
            } else if (entry.name.endsWith('.md') && fullPath !== currentFile) {
                try {
                    const content = await fsp.readFile(fullPath, 'utf8');
                    const tags = extractTagsFromContent(content);
                    const overlap = tags.filter(t => currentTags.includes(t)).length;
                    if (overlap > 0) {
                        const summary = extractSummaryFromContent(content);
                        candidates.set(fullPath, { filePath: fullPath, summary, score: overlap });
                    }
                } catch {}
            }
        }
    }

    private async aiRank(currentSummary: string, candidates: RelatedNote[]): Promise<RelatedNote[]> {
        const candidateList = candidates.map((c, i) => {
            const desc = c.summary || path.basename(c.filePath);
            return `${i + 1}. "${desc}"`;
        }).join('\n');

        const prompt = `Given this note summary: "${currentSummary}"

Rank these candidate notes by relevance (most related first). Return ONLY a JSON array of numbers, e.g. [2, 5, 1].

${candidateList}`;

        try {
            const response = await chatCompletionWithRetry(prompt);
            const match = response.match(/\[[\d,\s]+\]/);
            if (match) {
                const indices: number[] = JSON.parse(match[0]);
                const ranked: RelatedNote[] = [];
                for (const idx of indices) {
                    if (idx >= 1 && idx <= candidates.length && ranked.length < 5) {
                        ranked.push(candidates[idx - 1]);
                    }
                }
                return ranked;
            }
        } catch {}

        return candidates.slice(0, 5);
    }

    private getHtml(notes: RelatedNote[]): string {
        if (notes.length === 0) {
            return `<body style="font-family: var(--vscode-font-family); color: var(--vscode-sideBar-foreground); padding: 12px;">
                <i>No related notes found.</i>
            </body>`;
        }

        const items = notes.map(n => {
            const name = path.basename(n.filePath);
            const summaryHtml = n.summary
                ? `<div style="font-size:0.85em; opacity:0.7; margin-top:1px;">${escapeHtml(n.summary)}</div>`
                : '';
            return `<div class="related" data-path="${escapeHtml(n.filePath)}" style="cursor:pointer; padding:4px 8px; border-radius:3px; margin:2px 0;">
                <span style="color:var(--vscode-textLink-foreground);">${escapeHtml(name)}</span>
                ${summaryHtml}
            </div>`;
        }).join('');

        return `<body style="font-family: var(--vscode-font-family); color: var(--vscode-sideBar-foreground); padding: 12px;">
            <div style="font-weight:bold; margin-bottom:8px;">Related Notes (${notes.length})</div>
            ${items}
            <script>
                const vscode = acquireVsCodeApi();
                document.querySelectorAll('.related').forEach(el => {
                    el.addEventListener('click', () => {
                        vscode.postMessage({ command: 'openNote', path: el.getAttribute('data-path') });
                    });
                    el.addEventListener('mouseenter', () => { el.style.background = 'var(--vscode-list-hoverBackground)'; });
                    el.addEventListener('mouseleave', () => { el.style.background = ''; });
                });
            </script>
        </body>`;
    }

    dispose(): void {
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
        this.disposables.forEach(d => d.dispose());
    }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/relatedNotesWebview.ts
git commit -m "feat: add related notes webview with hybrid tag+AI ranking"
```

---

## Task 8: Related Notes — Register in Extension

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Add webview to package.json**

In `package.json`, in `contributes.views.explorer` array, add:

```json
{
    "id": "aiNotesRelatedWebView",
    "name": "AI Notes Related",
    "type": "webview"
}
```

- [ ] **Step 2: Register provider in extension.ts**

Add import at top:
```typescript
import { RelatedNotesWebviewProvider } from './relatedNotesWebview';
```

Add inside the `if (workspaceFolders)` block, after the backlinks registration:

```typescript
    // Related notes panel
    const relatedNotesProvider = new RelatedNotesWebviewProvider(workspaceFolders[0].uri.fsPath, tagCache);
    relatedNotesProvider.initialize();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            RelatedNotesWebviewProvider.viewType,
            relatedNotesProvider
        )
    );
    context.subscriptions.push(relatedNotesProvider);
```

Note: `tagCache` is already instantiated earlier in the same block.

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: register related notes webview in extension"
```

---

## Task 9: Smart Collections — Core Module

**Files:**
- Create: `src/smartCollections.ts`
- Create: `src/test/smartCollections.test.ts`

- [ ] **Step 1: Write failing tests for collection filtering**

Create `src/test/smartCollections.test.ts`:

```typescript
import * as assert from 'assert';
import { matchesCollection, parseDateFromFilename } from '../smartCollections';

suite('SmartCollections', () => {
    test('parseDateFromFilename extracts DD-MM-YYYY', () => {
        const date = parseDateFromFilename('meeting_05-05-2026.md');
        assert.strictEqual(date!.getFullYear(), 2026);
        assert.strictEqual(date!.getMonth(), 4); // 0-indexed
        assert.strictEqual(date!.getDate(), 5);
    });

    test('parseDateFromFilename returns null for no date', () => {
        const date = parseDateFromFilename('readme.md');
        assert.strictEqual(date, null);
    });

    test('matchesCollection filters by tags (AND logic)', () => {
        const collection = { name: 'test', tags: ['meeting', 'team'], dateRange: null, query: null };
        const noteWithBoth = { tags: ['meeting', 'team', 'standup'], date: null, filePath: '' };
        const noteWithOne = { tags: ['meeting'], date: null, filePath: '' };
        assert.strictEqual(matchesCollection(noteWithBoth, collection), true);
        assert.strictEqual(matchesCollection(noteWithOne, collection), false);
    });

    test('matchesCollection filters by dateRange', () => {
        const collection = { name: 'test', tags: null, dateRange: 7, query: null };
        const recent = { tags: [], date: new Date(), filePath: '' };
        const old = { tags: [], date: new Date('2020-01-01'), filePath: '' };
        assert.strictEqual(matchesCollection(recent, collection), true);
        assert.strictEqual(matchesCollection(old, collection), false);
    });

    test('matchesCollection passes when no filters set', () => {
        const collection = { name: 'test', tags: null, dateRange: null, query: null };
        const note = { tags: [], date: null, filePath: '' };
        assert.strictEqual(matchesCollection(note, collection), true);
    });
});
```

- [ ] **Step 2: Implement smart collections module**

Create `src/smartCollections.ts`:

```typescript
import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { extractTagsFromContent } from './tagCache';
import { searchNotes, gatherNotes } from './semanticSearch';

export interface Collection {
    name: string;
    tags: string[] | null;
    dateRange: number | null;
    query: string | null;
}

interface CollectionsFile {
    collections: Collection[];
}

export interface NoteForFilter {
    tags: string[];
    date: Date | null;
    filePath: string;
}

export function parseDateFromFilename(filename: string): Date | null {
    const match = filename.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (!match) { return null; }
    const [, dd, mm, yyyy] = match;
    const date = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    if (isNaN(date.getTime())) { return null; }
    return date;
}

export function matchesCollection(note: NoteForFilter, collection: Collection): boolean {
    if (collection.tags && collection.tags.length > 0) {
        const hasAll = collection.tags.every(t => note.tags.includes(t));
        if (!hasAll) { return false; }
    }

    if (collection.dateRange !== null && collection.dateRange > 0) {
        if (!note.date) { return false; }
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - collection.dateRange);
        if (note.date < cutoff) { return false; }
    }

    return true;
}

export async function loadCollections(workspaceRoot: string): Promise<Collection[]> {
    const filePath = path.join(workspaceRoot, '.ai-notes', 'collections.json');
    try {
        const content = await fsp.readFile(filePath, 'utf8');
        const data: CollectionsFile = JSON.parse(content);
        return data.collections || [];
    } catch {
        return [];
    }
}

export async function saveCollections(workspaceRoot: string, collections: Collection[]): Promise<void> {
    const dirPath = path.join(workspaceRoot, '.ai-notes');
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    const filePath = path.join(dirPath, 'collections.json');
    const data: CollectionsFile = { collections };
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function runCollection(
    collection: Collection,
    workspaceRoot: string
): Promise<string[]> {
    const allNotes = await gatherNotesForFilter(workspaceRoot);

    let filtered = allNotes.filter(note => matchesCollection(note, collection));

    if (collection.query && filtered.length > 0) {
        const noteInfos = await gatherNotes(workspaceRoot);
        const filteredPaths = new Set(filtered.map(n => n.filePath));
        const relevantNotes = noteInfos.filter(n => filteredPaths.has(n.filePath));
        return searchNotes(collection.query, relevantNotes);
    }

    return filtered.map(n => n.filePath);
}

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', '.claude', '_drafts']);

async function gatherNotesForFilter(workspaceRoot: string): Promise<NoteForFilter[]> {
    const notes: NoteForFilter[] = [];
    await walkForFilter(workspaceRoot, notes);
    return notes;
}

async function walkForFilter(dir: string, notes: NoteForFilter[]): Promise<void> {
    let entries;
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) { continue; }
            await walkForFilter(fullPath, notes);
        } else if (entry.name.endsWith('.md')) {
            try {
                const content = await fsp.readFile(fullPath, 'utf8');
                const tags = extractTagsFromContent(content);
                const date = parseDateFromFilename(entry.name);
                notes.push({ tags, date, filePath: fullPath });
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
git add src/smartCollections.ts src/test/smartCollections.test.ts
git commit -m "feat: add smart collections module with filtering and persistence"
```

---

## Task 10: Smart Collections — Register Command

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Add command to package.json**

In `package.json`, in the `contributes.commands` array, add:

```json
{
    "command": "ai-notes.smartCollections",
    "title": "AI Notes: Smart Collections"
}
```

- [ ] **Step 2: Register command in extension.ts**

Add import at top:
```typescript
import { loadCollections, saveCollections, runCollection, Collection } from './smartCollections';
```

Add command registration inside `activate()`, after the `semanticSearchDisposable` block:

```typescript
    // Smart collections command
    const smartCollectionsDisposable = vscode.commands.registerCommand('ai-notes.smartCollections', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }
        const rootDir = workspaceFolders[0].uri.fsPath;

        const collections = await loadCollections(rootDir);
        const items: vscode.QuickPickItem[] = [
            ...collections.map(c => ({
                label: c.name,
                description: [
                    c.tags ? `tags: ${c.tags.join(', ')}` : '',
                    c.dateRange ? `last ${c.dateRange} days` : '',
                    c.query ? `query: "${c.query}"` : '',
                ].filter(Boolean).join(' | '),
            })),
            { label: '$(add) New Collection...', description: 'Create a new saved collection' },
            ...(collections.length > 0 ? [{ label: '$(trash) Delete Collection...', description: 'Remove a saved collection' }] : []),
        ];

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a collection to run, or create a new one',
        });
        if (!picked) { return; }

        if (picked.label === '$(add) New Collection...') {
            const name = await vscode.window.showInputBox({ prompt: 'Collection name' });
            if (!name) { return; }

            const tagsInput = await vscode.window.showInputBox({
                prompt: 'Filter by tags (comma-separated, leave empty to skip)',
                placeHolder: 'meeting, team',
            });
            const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : null;

            const dateInput = await vscode.window.showInputBox({
                prompt: 'Filter by date range (number of days, leave empty to skip)',
                placeHolder: '14',
            });
            const dateRange = dateInput ? parseInt(dateInput) : null;

            const query = await vscode.window.showInputBox({
                prompt: 'Semantic query (leave empty to skip)',
                placeHolder: 'authentication and security',
            });

            const newCollection: Collection = {
                name,
                tags: tags && tags.length > 0 ? tags : null,
                dateRange: dateRange && !isNaN(dateRange) ? dateRange : null,
                query: query || null,
            };

            collections.push(newCollection);
            await saveCollections(rootDir, collections);
            vscode.window.showInformationMessage(`Collection "${name}" created.`);
            return;
        }

        if (picked.label === '$(trash) Delete Collection...') {
            const toDelete = await vscode.window.showQuickPick(
                collections.map(c => ({ label: c.name })),
                { placeHolder: 'Select collection to delete' }
            );
            if (!toDelete) { return; }
            const updated = collections.filter(c => c.name !== toDelete.label);
            await saveCollections(rootDir, updated);
            vscode.window.showInformationMessage(`Collection "${toDelete.label}" deleted.`);
            return;
        }

        // Run the selected collection
        const collection = collections.find(c => c.name === picked.label);
        if (!collection) { return; }

        const results = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Running "${collection.name}"...` },
            () => runCollection(collection, rootDir)
        );

        if (results.length === 0) {
            vscode.window.showInformationMessage('No notes match this collection.');
            return;
        }

        const resultItems = results.map(filePath => ({
            label: path.basename(filePath),
            description: path.relative(rootDir, filePath),
            detail: filePath,
        }));

        const selected = await vscode.window.showQuickPick(resultItems, {
            placeHolder: `${results.length} notes in "${collection.name}"`,
        });
        if (selected) {
            const uri = vscode.Uri.file(selected.detail!);
            await vscode.window.showTextDocument(uri);
        }
    });
    context.subscriptions.push(smartCollectionsDisposable);
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: register smart collections command with CRUD and QuickPick"
```

---

## Summary

| Task | Feature | Effort |
|------|---------|--------|
| 1 | Export chatCompletionWithRetry | Trivial |
| 2 | Summaries core module | Small |
| 3 | Summaries command registration | Small |
| 4 | Tag browser summary display | Medium |
| 5 | Semantic search core module | Medium |
| 6 | Semantic search command | Small |
| 7 | Related notes webview | Medium |
| 8 | Related notes registration | Trivial |
| 9 | Smart collections core module | Medium |
| 10 | Smart collections command | Medium |

Total: 10 focused tasks, each independently committable and testable.
