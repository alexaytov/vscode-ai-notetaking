# Approach C1: AI Content Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add note merging, topic-based MOC generation, and AI chat over notes to the extension.

**Architecture:** Note merging and MOC generation are command-based features using the existing AI pipeline and file system utilities. The AI chat is a new webview type with a message input, scrollable history, and multi-turn conversation state. All features reuse `chatCompletionWithRetry` and `gatherNotes`.

**Tech Stack:** TypeScript, VS Code Extension API, VS Code Webview API (chat panel), existing AI pipeline.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/noteMerger.ts` (create) | Merge logic: read notes, build prompt, call AI, create output file |
| `src/mocGenerator.ts` (create) | MOC logic: cluster notes via AI, generate markdown files |
| `src/chatWebview.ts` (create) | Chat webview provider: HTML/CSS/JS UI, conversation state, message handling |
| `src/notesByTagWebview.ts` (modify) | Add "Merge Selected" button and message handler |
| `src/extension.ts` (modify) | Register commands and chat webview |
| `package.json` (modify) | Register commands and webview view |
| `src/test/noteMerger.test.ts` (create) | Unit tests for word count checking |
| `src/test/mocGenerator.test.ts` (create) | Unit tests for slug generation and MOC parsing |

---

## Task 1: Note Merger — Core Module

**Files:**
- Create: `src/noteMerger.ts`
- Create: `src/test/noteMerger.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/noteMerger.test.ts`:

```typescript
import * as assert from 'assert';
import { countWords, stripFrontmatter } from '../noteMerger';

suite('NoteMerger', () => {
    test('countWords counts words in text', () => {
        assert.strictEqual(countWords('hello world foo bar'), 4);
    });

    test('countWords handles empty string', () => {
        assert.strictEqual(countWords(''), 0);
    });

    test('countWords handles whitespace-only', () => {
        assert.strictEqual(countWords('   \n\t  '), 0);
    });

    test('stripFrontmatter removes YAML block', () => {
        const content = '---\ntags: [test]\n---\n# Hello\nContent here';
        assert.strictEqual(stripFrontmatter(content), '# Hello\nContent here');
    });

    test('stripFrontmatter returns content unchanged without frontmatter', () => {
        const content = '# Hello\nContent here';
        assert.strictEqual(stripFrontmatter(content), '# Hello\nContent here');
    });
});
```

- [ ] **Step 2: Implement note merger module**

Create `src/noteMerger.ts`:

```typescript
import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { chatCompletionWithRetry } from './ai';

export function countWords(text: string): number {
    const trimmed = text.trim();
    if (trimmed.length === 0) { return 0; }
    return trimmed.split(/\s+/).length;
}

export function stripFrontmatter(content: string): string {
    return content.replace(/^---\n(?:.*\n)*?---\n/, '');
}

export async function mergeNotes(notePaths: string[], workspaceRoot: string): Promise<string> {
    const contents: string[] = [];
    let totalWords = 0;

    for (const notePath of notePaths) {
        const raw = await fsp.readFile(notePath, 'utf8');
        const cleaned = stripFrontmatter(raw);
        contents.push(`## Source: ${path.basename(notePath)}\n\n${cleaned}`);
        totalWords += countWords(cleaned);
    }

    if (totalWords > 8000) {
        const proceed = await vscode.window.showWarningMessage(
            `Selected notes contain ~${totalWords} words (recommended limit: 8000). Continue?`,
            'Continue',
            'Cancel'
        );
        if (proceed !== 'Continue') {
            throw new Error('Merge cancelled by user.');
        }
    }

    const combined = contents.join('\n\n---\n\n');
    const prompt = `Merge these notes into a single comprehensive document. Preserve all key information, remove redundancy, organize logically with clear headings. Output markdown only.

Notes to merge:

${combined}`;

    const merged = await chatCompletionWithRetry(prompt);

    // Write to _drafts/
    const draftsDir = path.join(workspaceRoot, '_drafts');
    if (!fs.existsSync(draftsDir)) {
        fs.mkdirSync(draftsDir, { recursive: true });
    }

    const date = new Date();
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const fileName = `merged_${dd}-${mm}-${yyyy}_${uuidv4().slice(0, 8)}.md`;
    const outputPath = path.join(draftsDir, fileName);

    await fsp.writeFile(outputPath, merged, 'utf8');
    return outputPath;
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/noteMerger.ts src/test/noteMerger.test.ts
git commit -m "feat: add note merger module with AI-powered synthesis"
```

---

## Task 2: Note Merger — Register Command & Tag Browser Integration

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/notesByTagWebview.ts`
- Modify: `package.json`

- [ ] **Step 1: Add command to package.json**

In `contributes.commands` array, add:

```json
{
    "command": "ai-notes.mergeNotes",
    "title": "AI Notes: Merge Notes"
}
```

- [ ] **Step 2: Register merge command in extension.ts**

Add import at top:
```typescript
import { mergeNotes } from './noteMerger';
```

Add command registration after the `smartCollectionsDisposable` block:

```typescript
    // Merge notes command
    const mergeNotesDisposable = vscode.commands.registerCommand('ai-notes.mergeNotes', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }
        const rootDir = workspaceFolders[0].uri.fsPath;

        const notes = await gatherNotes(rootDir);
        const items = notes.map(n => ({
            label: path.basename(n.filePath),
            description: n.summary || n.snippet.slice(0, 50),
            detail: n.filePath,
            picked: false,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select notes to merge (hold Ctrl/Cmd for multiple)',
            canPickMany: true,
        });
        if (!selected || selected.length < 2) {
            vscode.window.showErrorMessage('Select at least 2 notes to merge.');
            return;
        }

        try {
            const outputPath = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Merging notes...' },
                () => mergeNotes(selected.map(s => s.detail!), rootDir)
            );
            const uri = vscode.Uri.file(outputPath);
            await vscode.window.showTextDocument(uri);
            vscode.window.showInformationMessage(`Merged ${selected.length} notes into new draft.`);
        } catch (err: any) {
            if (err.message !== 'Merge cancelled by user.') {
                vscode.window.showErrorMessage(`Merge failed: ${err.message}`);
            }
        }
    });
    context.subscriptions.push(mergeNotesDisposable);
```

- [ ] **Step 3: Add "Merge Selected" button to tag browser**

In `src/notesByTagWebview.ts`, in the `getHtmlForWebview` method, add a button after the `bulkReclassify` button in the filter bar HTML:

```html
<button id="mergeSelected" title="Merge selected notes" style="margin-left:4px; display:none;">Merge Selected</button>
```

Add CSS for `#mergeSelected` (same style as `#bulkReclassify`):
```css
#mergeSelected {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 0.95em;
    cursor: pointer;
    transition: background 0.2s;
    display: none;
}
#mergeSelected:hover {
    background: var(--vscode-button-hoverBackground);
}
```

In the JavaScript `updateSelectionUI` function, add:
```javascript
document.getElementById('mergeSelected').style.display = count >= 2 ? 'inline-block' : 'none';
```

Add click handler:
```javascript
document.getElementById('mergeSelected').addEventListener('click', function() {
    vscode.postMessage({ command: 'mergeNotes', paths: Array.from(selectedNotes) });
});
```

- [ ] **Step 4: Handle mergeNotes message in webview provider**

In `src/notesByTagWebview.ts`, add a public callback property (alongside existing `onBulkReclassify`):
```typescript
public onMergeNotes?: (paths: string[]) => void;
```

In the `onDidReceiveMessage` handler, add:
```typescript
if (message.command === 'mergeNotes') {
    const paths: string[] = message.paths;
    if (this.onMergeNotes) {
        this.onMergeNotes(paths);
    }
}
```

- [ ] **Step 5: Wire up the merge callback in extension.ts**

Where `notesByTagProvider` is created (around line 143), add after the `onBulkReclassify` assignment:
```typescript
notesByTagProvider.onMergeNotes = async (paths) => {
    try {
        const outputPath = await mergeNotes(paths, workspaceFolders[0].uri.fsPath);
        const uri = vscode.Uri.file(outputPath);
        await vscode.window.showTextDocument(uri);
        vscode.window.showInformationMessage(`Merged ${paths.length} notes into new draft.`);
    } catch (err: any) {
        if (err.message !== 'Merge cancelled by user.') {
            vscode.window.showErrorMessage(`Merge failed: ${err.message}`);
        }
    }
};
```

- [ ] **Step 6: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/extension.ts src/notesByTagWebview.ts package.json
git commit -m "feat: register merge command and add Merge Selected to tag browser"
```

---

## Task 3: MOC Generator — Core Module

**Files:**
- Create: `src/mocGenerator.ts`
- Create: `src/test/mocGenerator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/test/mocGenerator.test.ts`:

```typescript
import * as assert from 'assert';
import { slugify, parseClusterResponse } from '../mocGenerator';

suite('MOCGenerator', () => {
    test('slugify converts to lowercase dashes', () => {
        assert.strictEqual(slugify('Hello World'), 'hello-world');
    });

    test('slugify removes special characters', () => {
        assert.strictEqual(slugify('C++ & Python!'), 'c-python');
    });

    test('slugify collapses multiple dashes', () => {
        assert.strictEqual(slugify('foo - bar -- baz'), 'foo-bar-baz');
    });

    test('parseClusterResponse parses valid JSON', () => {
        const response = '[{"topic":"Meetings","description":"Team meetings","noteIndices":[1,3]}]';
        const clusters = parseClusterResponse(response);
        assert.strictEqual(clusters.length, 1);
        assert.strictEqual(clusters[0].topic, 'Meetings');
        assert.deepStrictEqual(clusters[0].noteIndices, [1, 3]);
    });

    test('parseClusterResponse extracts JSON from wrapped response', () => {
        const response = 'Here are the clusters:\n[{"topic":"A","description":"desc","noteIndices":[1]}]\nDone!';
        const clusters = parseClusterResponse(response);
        assert.strictEqual(clusters.length, 1);
    });

    test('parseClusterResponse returns empty on invalid', () => {
        const clusters = parseClusterResponse('not json at all');
        assert.deepStrictEqual(clusters, []);
    });
});
```

- [ ] **Step 2: Implement MOC generator module**

Create `src/mocGenerator.ts`:

```typescript
import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { chatCompletionWithRetry } from './ai';
import { gatherNotes, NoteInfo } from './semanticSearch';

export interface NoteCluster {
    topic: string;
    description: string;
    noteIndices: number[];
}

export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

export function parseClusterResponse(response: string): NoteCluster[] {
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) { return []; }
    try {
        const arr = JSON.parse(match[0]);
        if (Array.isArray(arr) && arr.every(item =>
            typeof item.topic === 'string' &&
            typeof item.description === 'string' &&
            Array.isArray(item.noteIndices)
        )) {
            return arr;
        }
    } catch {}
    return [];
}

export async function generateMOC(workspaceRoot: string): Promise<string> {
    const notes = await gatherNotes(workspaceRoot);

    if (notes.length === 0) {
        throw new Error('No notes found in workspace.');
    }

    const noteList = notes.map((n, i) => {
        const name = path.basename(n.filePath);
        const desc = n.summary || n.snippet.slice(0, 60);
        return `${i + 1}. ${name} — ${desc}`;
    }).join('\n');

    const prompt = `Group these notes into 3-7 topic clusters based on their content and tags. Return ONLY a JSON array: [{ "topic": "Topic Name", "description": "One sentence description", "noteIndices": [1, 3, 5] }]

Notes:
${noteList}`;

    const response = await chatCompletionWithRetry(prompt);
    const clusters = parseClusterResponse(response);

    if (clusters.length === 0) {
        throw new Error('AI failed to generate topic clusters.');
    }

    // Create _moc/ directory
    const mocDir = path.join(workspaceRoot, '_moc');
    if (fs.existsSync(mocDir)) {
        const existing = await fsp.readdir(mocDir);
        for (const file of existing) {
            await fsp.unlink(path.join(mocDir, file));
        }
    } else {
        fs.mkdirSync(mocDir, { recursive: true });
    }

    // Generate topic files
    const indexEntries: string[] = [];

    for (const cluster of clusters) {
        const slug = slugify(cluster.topic);
        const noteLinks = cluster.noteIndices
            .filter(i => i >= 1 && i <= notes.length)
            .map(i => {
                const note = notes[i - 1];
                const relativePath = path.relative(mocDir, note.filePath);
                return `- [${path.basename(note.filePath)}](${relativePath})`;
            })
            .join('\n');

        const topicContent = `# ${cluster.topic}\n\n${cluster.description}\n\n## Notes\n\n${noteLinks}\n`;
        await fsp.writeFile(path.join(mocDir, `${slug}.md`), topicContent, 'utf8');

        indexEntries.push(`- [${cluster.topic}](${slug}.md) — ${cluster.description}`);
    }

    // Generate index
    const indexContent = `# Map of Content\n\n${indexEntries.join('\n')}\n`;
    const indexPath = path.join(mocDir, 'index.md');
    await fsp.writeFile(indexPath, indexContent, 'utf8');

    return indexPath;
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/mocGenerator.ts src/test/mocGenerator.test.ts
git commit -m "feat: add MOC generator with AI-powered topic clustering"
```

---

## Task 4: MOC Generator — Register Command

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Add command to package.json**

In `contributes.commands` array, add:

```json
{
    "command": "ai-notes.generateMOC",
    "title": "AI Notes: Generate Map of Content"
}
```

- [ ] **Step 2: Register command in extension.ts**

Add import at top:
```typescript
import { generateMOC } from './mocGenerator';
```

Add command registration after the `mergeNotesDisposable` block:

```typescript
    // Generate MOC command
    const generateMOCDisposable = vscode.commands.registerCommand('ai-notes.generateMOC', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }

        try {
            const indexPath = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Generating Map of Content...' },
                () => generateMOC(workspaceFolders[0].uri.fsPath)
            );
            const uri = vscode.Uri.file(indexPath);
            await vscode.window.showTextDocument(uri);
            vscode.window.showInformationMessage('Map of Content generated.');
        } catch (err: any) {
            vscode.window.showErrorMessage(`MOC generation failed: ${err.message}`);
        }
    });
    context.subscriptions.push(generateMOCDisposable);
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: register MOC generation command"
```

---

## Task 5: AI Chat — Webview Provider

**Files:**
- Create: `src/chatWebview.ts`

- [ ] **Step 1: Implement the chat webview**

Create `src/chatWebview.ts`:

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { chatCompletionWithRetry } from './ai';
import { gatherNotes, NoteInfo, buildNoteEntry } from './semanticSearch';

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiNotesChatWebView';
    private view?: vscode.WebviewView;
    private history: ChatMessage[] = [];
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(async message => {
            if (message.command === 'sendMessage') {
                await this.handleUserMessage(message.text);
            }
            if (message.command === 'clear') {
                this.history = [];
                this.updateChat();
            }
            if (message.command === 'openNote') {
                const uri = vscode.Uri.file(message.path);
                vscode.window.showTextDocument(uri);
            }
        });
    }

    private async handleUserMessage(text: string): Promise<void> {
        this.history.push({ role: 'user', content: text });
        this.updateChat();

        try {
            const notes = await gatherNotes(this.workspaceRoot);
            const context = this.buildContext(notes);
            const conversationHistory = this.history.slice(-20).map(m =>
                `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
            ).join('\n\n');

            const prompt = `You are a helpful assistant that answers questions about the user's notes. Cite referenced notes by filename in square brackets like [filename.md].

Available notes:
${context}

Conversation:
${conversationHistory}

Answer the user's latest question based on the notes above.`;

            const response = await chatCompletionWithRetry(prompt);
            this.history.push({ role: 'assistant', content: response });
        } catch (err: any) {
            this.history.push({ role: 'assistant', content: `Error: ${err.message}` });
        }

        this.updateChat();
    }

    private buildContext(notes: NoteInfo[]): string {
        return notes.map(n => {
            const entry = buildNoteEntry(n.filePath, n.summary, n.snippet);
            return entry;
        }).join('\n');
    }

    private updateChat(): void {
        if (!this.view) { return; }
        this.view.webview.html = this.getHtml();
    }

    private renderMessages(): string {
        return this.history.map(m => {
            const cls = m.role === 'user' ? 'user-msg' : 'ai-msg';
            const label = m.role === 'user' ? 'You' : 'AI';
            const content = this.renderContent(m.content);
            return `<div class="msg ${cls}"><strong>${label}:</strong> ${content}</div>`;
        }).join('');
    }

    private renderContent(content: string): string {
        const escaped = escapeHtml(content);
        return escaped.replace(/\[([^\]]+\.md)\]/g, (match, filename) => {
            return `<span class="note-ref" data-filename="${escapeHtml(filename)}">[${escapeHtml(filename)}]</span>`;
        });
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html>
<head>
<style>
    body { font-family: var(--vscode-font-family); background: var(--vscode-sideBar-background); color: var(--vscode-sideBar-foreground); margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; }
    #messages { flex: 1; overflow-y: auto; padding: 12px; }
    .msg { margin-bottom: 12px; padding: 8px; border-radius: 6px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word; }
    .user-msg { background: var(--vscode-input-background); }
    .ai-msg { background: var(--vscode-editor-background); }
    .note-ref { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; }
    #input-area { padding: 8px; border-top: 1px solid var(--vscode-input-border); display: flex; gap: 4px; }
    #input { flex: 1; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-size: 0.95em; }
    #sendBtn, #clearBtn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 0.9em; }
    #sendBtn:hover, #clearBtn:hover { background: var(--vscode-button-hoverBackground); }
    #clearBtn { background: none; color: var(--vscode-textLink-foreground); padding: 6px 8px; }
</style>
</head>
<body>
    <div id="messages">${this.renderMessages()}</div>
    <div id="input-area">
        <input id="input" type="text" placeholder="Ask about your notes..." />
        <button id="sendBtn">Send</button>
        <button id="clearBtn">Clear</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();

        document.getElementById('sendBtn').addEventListener('click', send);
        document.getElementById('input').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { send(); }
        });
        document.getElementById('clearBtn').addEventListener('click', function() {
            vscode.postMessage({ command: 'clear' });
        });

        function send() {
            const input = document.getElementById('input');
            const text = input.value.trim();
            if (!text) { return; }
            input.value = '';
            vscode.postMessage({ command: 'sendMessage', text: text });
        }

        document.querySelectorAll('.note-ref').forEach(function(el) {
            el.addEventListener('click', function() {
                vscode.postMessage({ command: 'openNote', path: el.getAttribute('data-filename') });
            });
        });

        // Scroll to bottom
        const msgs = document.getElementById('messages');
        msgs.scrollTop = msgs.scrollHeight;
    </script>
</body>
</html>`;
    }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/chatWebview.ts
git commit -m "feat: add AI chat webview with multi-turn conversation"
```

---

## Task 6: AI Chat — Register in Extension

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Add webview to package.json**

In `contributes.views.explorer` array, add:

```json
{
    "id": "aiNotesChatWebView",
    "name": "AI Notes Chat",
    "type": "webview"
}
```

- [ ] **Step 2: Register provider in extension.ts**

Add import at top:
```typescript
import { ChatWebviewProvider } from './chatWebview';
```

Add inside the `if (workspaceFolders)` block, after the related notes registration:

```typescript
    // AI Chat panel
    const chatProvider = new ChatWebviewProvider(workspaceFolders[0].uri.fsPath);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatWebviewProvider.viewType,
            chatProvider
        )
    );
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: register AI chat webview in extension"
```

---

## Summary

| Task | Feature | Effort |
|------|---------|--------|
| 1 | Note merger core module | Small |
| 2 | Merge command + tag browser integration | Medium |
| 3 | MOC generator core module | Medium |
| 4 | MOC command registration | Small |
| 5 | Chat webview provider | Large |
| 6 | Chat webview registration | Trivial |

Total: 6 focused tasks, each independently committable and testable.
