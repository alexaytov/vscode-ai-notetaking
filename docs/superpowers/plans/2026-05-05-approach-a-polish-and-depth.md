# Approach A: Polish & Depth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 features (tag autocomplete, note templates, auto-classify on save, backlinks panel, bulk reclassify) that improve the note-writing and organization experience.

**Architecture:** Each feature is an independent module registered in `extension.ts`. They share the existing AI pipeline (`ai.ts`), frontmatter utilities (`frontmatter.ts`), and filesystem walk patterns. New webview follows the same pattern as `notesByTagWebview.ts`. All features use VS Code's standard APIs (CompletionItemProvider, WebviewViewProvider, FileSystemWatcher).

**Tech Stack:** TypeScript, VS Code Extension API, esbuild bundler, marked (for HTML), existing AI pipeline (VS Code LM API / SAP AI Core).

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/tagCompletionProvider.ts` (create) | CompletionItemProvider that suggests existing tags inside frontmatter |
| `src/tagCache.ts` (create) | Scans workspace for tags, caches results, invalidates on file changes |
| `src/templates.ts` (create) | Template discovery (bundled + workspace), variable expansion |
| `resources/templates/meeting.md` (create) | Built-in meeting template |
| `resources/templates/journal.md` (create) | Built-in journal template |
| `resources/templates/til.md` (create) | Built-in TIL template |
| `src/autoClassify.ts` (create) | Persistent _drafts/ save listener with debounce |
| `src/backlinksWebview.ts` (create) | Backlinks webview provider + link index |
| `src/notesByTagWebview.ts` (modify) | Add checkboxes, selection state, bulk reclassify button |
| `src/extension.ts` (modify) | Register new providers, commands, watchers |
| `package.json` (modify) | Add webview view, commands |
| `src/test/tagCache.test.ts` (create) | Unit tests for tag cache |
| `src/test/templates.test.ts` (create) | Unit tests for template expansion |
| `src/test/autoClassify.test.ts` (create) | Unit tests for debounce/skip logic |
| `src/test/backlinks.test.ts` (create) | Unit tests for link index |

---

## Task 1: Tag Cache Module

**Files:**
- Create: `src/tagCache.ts`
- Create: `src/test/tagCache.test.ts`

- [ ] **Step 1: Write the failing test for tag extraction from frontmatter**

Create `src/test/tagCache.test.ts`:

```typescript
import * as assert from 'assert';
import { extractTagsFromContent } from '../tagCache';

suite('TagCache', () => {
    test('extracts tags from valid frontmatter', () => {
        const content = '---\ntags: [javascript, testing, vscode]\n---\n# Hello';
        const tags = extractTagsFromContent(content);
        assert.deepStrictEqual(tags, ['javascript', 'testing', 'vscode']);
    });

    test('returns empty array when no frontmatter', () => {
        const content = '# Hello\nSome content';
        const tags = extractTagsFromContent(content);
        assert.deepStrictEqual(tags, []);
    });

    test('returns empty array when no tags key', () => {
        const content = '---\ntitle: My Note\n---\n# Hello';
        const tags = extractTagsFromContent(content);
        assert.deepStrictEqual(tags, []);
    });

    test('handles tags with extra spaces', () => {
        const content = '---\ntags: [ foo ,  bar , baz ]\n---\n';
        const tags = extractTagsFromContent(content);
        assert.deepStrictEqual(tags, ['foo', 'bar', 'baz']);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run compile && npx vscode-test --run src/test/tagCache.test.ts`
Expected: FAIL with "Cannot find module '../tagCache'"

- [ ] **Step 3: Implement tagCache module**

Create `src/tagCache.ts`:

```typescript
import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';

export function extractTagsFromContent(content: string): string[] {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) { return []; }
    const yaml = match[1];
    const tagsLine = yaml.split('\n').find(line => line.trim().startsWith('tags:'));
    if (!tagsLine) { return []; }
    const tagsMatch = tagsLine.match(/\[(.*?)\]/);
    if (!tagsMatch) { return []; }
    return tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
}

export class TagCache {
    private tags: Map<string, number> = new Map();
    private initialized = false;
    private disposables: vscode.Disposable[] = [];

    constructor(private workspaceRoot: string) {}

    async initialize(): Promise<void> {
        if (this.initialized) { return; }
        await this.fullScan();
        this.initialized = true;

        const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
        watcher.onDidChange(uri => this.rescanFile(uri.fsPath));
        watcher.onDidCreate(uri => this.rescanFile(uri.fsPath));
        watcher.onDidDelete(uri => this.removeFile(uri.fsPath));
        this.disposables.push(watcher);
    }

    getTagsWithFrequency(): Array<{ tag: string; count: number }> {
        return Array.from(this.tags.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);
    }

    getAllTags(): string[] {
        return Array.from(this.tags.keys()).sort();
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }

    private async fullScan(): Promise<void> {
        this.tags.clear();
        await this.walk(this.workspaceRoot);
    }

    private async walk(dir: string): Promise<void> {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch { return; }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await this.walk(fullPath);
            } else if (entry.name.endsWith('.md')) {
                await this.indexFile(fullPath);
            }
        }
    }

    private async indexFile(filePath: string): Promise<void> {
        try {
            const content = await fsp.readFile(filePath, 'utf8');
            const tags = extractTagsFromContent(content);
            for (const tag of tags) {
                this.tags.set(tag, (this.tags.get(tag) || 0) + 1);
            }
        } catch {}
    }

    private async rescanFile(filePath: string): Promise<void> {
        if (!filePath.endsWith('.md')) { return; }
        // Rebuild entirely for simplicity — fast enough for typical note workspaces
        await this.fullScan();
    }

    private removeFile(_filePath: string): void {
        // Rebuild — simpler than tracking per-file tag assignments
        this.fullScan();
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && npx vscode-test --run src/test/tagCache.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tagCache.ts src/test/tagCache.test.ts
git commit -m "feat: add tag cache module with workspace scanning"
```

---

## Task 2: Tag Completion Provider

**Files:**
- Create: `src/tagCompletionProvider.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the tag completion provider**

Create `src/tagCompletionProvider.ts`:

```typescript
import * as vscode from 'vscode';
import { TagCache } from './tagCache';

export class TagCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private tagCache: TagCache) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] | undefined {
        if (!this.isInsideTagsField(document, position)) {
            return undefined;
        }

        const tagsWithFrequency = this.tagCache.getTagsWithFrequency();
        return tagsWithFrequency.map(({ tag, count }) => {
            const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Value);
            item.detail = `used ${count} time${count !== 1 ? 's' : ''}`;
            item.insertText = tag;
            return item;
        });
    }

    private isInsideTagsField(document: vscode.TextDocument, position: vscode.Position): boolean {
        const text = document.getText();
        const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) { return false; }

        const frontmatterEnd = text.indexOf('\n---', 4);
        const frontmatterEndLine = document.positionAt(frontmatterEnd + 4).line;

        if (position.line < 1 || position.line > frontmatterEndLine) {
            return false;
        }

        const line = document.lineAt(position.line).text;
        return /^\s*tags\s*:/.test(line) || /^\s*tags\s*:\s*\[/.test(line);
    }
}
```

- [ ] **Step 2: Register the provider in extension.ts**

Add to the top of `src/extension.ts` imports:

```typescript
import { TagCache } from './tagCache';
import { TagCompletionProvider } from './tagCompletionProvider';
```

Add inside the `activate` function, after the webview registration block:

```typescript
    // Tag autocomplete
    const tagCache = new TagCache(workspaceFolders[0].uri.fsPath);
    tagCache.initialize();
    context.subscriptions.push(tagCache);
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'markdown', scheme: 'file' },
            new TagCompletionProvider(tagCache),
            ',', ' '
        )
    );
```

Note: The `TagCache` class needs a `dispose` method to satisfy `vscode.Disposable`. It already has one from Task 1.

- [ ] **Step 3: Compile and verify no type errors**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/tagCompletionProvider.ts src/extension.ts
git commit -m "feat: add tag autocomplete in frontmatter"
```

---

## Task 3: Note Templates — Built-in Templates

**Files:**
- Create: `resources/templates/meeting.md`
- Create: `resources/templates/journal.md`
- Create: `resources/templates/til.md`

- [ ] **Step 1: Create meeting template**

Create `resources/templates/meeting.md`:

```markdown
# {{title}}

**Date:** {{date}}

## Attendees

-

## Agenda

1.

## Discussion Notes



## Action Items

- [ ]
```

- [ ] **Step 2: Create journal template**

Create `resources/templates/journal.md`:

```markdown
# Journal — {{date}}

## Highlights

-

## What I Worked On



## Reflections


```

- [ ] **Step 3: Create TIL template**

Create `resources/templates/til.md`:

```markdown
# TIL: {{title}}

**Date:** {{date}}

## What I Learned



## Key Takeaways

-

## References

-
```

- [ ] **Step 4: Commit**

```bash
git add resources/templates/
git commit -m "feat: add built-in note templates (meeting, journal, til)"
```

---

## Task 4: Note Templates — Discovery & Expansion Module

**Files:**
- Create: `src/templates.ts`
- Create: `src/test/templates.test.ts`

- [ ] **Step 1: Write failing tests for template variable expansion**

Create `src/test/templates.test.ts`:

```typescript
import * as assert from 'assert';
import { expandTemplateVariables } from '../templates';

suite('Templates', () => {
    test('expands {{date}} to current date', () => {
        const result = expandTemplateVariables('**Date:** {{date}}');
        // Should match dd-mm-yyyy format
        assert.match(result, /\*\*Date:\*\* \d{2}-\d{2}-\d{4}/);
    });

    test('expands {{title}} to provided title', () => {
        const result = expandTemplateVariables('# {{title}}', 'My Note');
        assert.strictEqual(result, '# My Note');
    });

    test('uses placeholder when no title provided', () => {
        const result = expandTemplateVariables('# {{title}}');
        assert.strictEqual(result, '# Untitled');
    });

    test('leaves unknown variables unchanged', () => {
        const result = expandTemplateVariables('{{unknown}}');
        assert.strictEqual(result, '{{unknown}}');
    });

    test('handles multiple variables in one string', () => {
        const result = expandTemplateVariables('# {{title}}\n**Date:** {{date}}', 'Test');
        assert.match(result, /^# Test\n\*\*Date:\*\* \d{2}-\d{2}-\d{4}$/);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && npx vscode-test --run src/test/templates.test.ts`
Expected: FAIL with "Cannot find module '../templates'"

- [ ] **Step 3: Implement the templates module**

Create `src/templates.ts`:

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as fs from 'fs';

export interface TemplateInfo {
    name: string;
    filePath: string;
    source: 'built-in' | 'workspace';
}

function formatDateDDMMYYYY(): string {
    const date = new Date();
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}

export function expandTemplateVariables(content: string, title?: string): string {
    let result = content;
    result = result.replace(/\{\{date\}\}/g, formatDateDDMMYYYY());
    result = result.replace(/\{\{title\}\}/g, title || 'Untitled');
    return result;
}

export async function discoverTemplates(
    extensionPath: string,
    workspaceRoot: string
): Promise<TemplateInfo[]> {
    const templates: TemplateInfo[] = [];

    // Built-in templates from extension resources
    const builtInDir = path.join(extensionPath, 'resources', 'templates');
    try {
        const entries = await fsp.readdir(builtInDir);
        for (const entry of entries) {
            if (entry.endsWith('.md')) {
                templates.push({
                    name: path.basename(entry, '.md'),
                    filePath: path.join(builtInDir, entry),
                    source: 'built-in',
                });
            }
        }
    } catch {}

    // Workspace templates from .templates/ folder
    const workspaceTemplateDir = path.join(workspaceRoot, '.templates');
    try {
        const entries = await fsp.readdir(workspaceTemplateDir);
        for (const entry of entries) {
            if (entry.endsWith('.md')) {
                templates.push({
                    name: path.basename(entry, '.md'),
                    filePath: path.join(workspaceTemplateDir, entry),
                    source: 'workspace',
                });
            }
        }
    } catch {}

    return templates;
}

export async function loadTemplateContent(templatePath: string): Promise<string> {
    return fsp.readFile(templatePath, 'utf8');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && npx vscode-test --run src/test/templates.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/templates.ts src/test/templates.test.ts
git commit -m "feat: add template discovery and variable expansion"
```

---

## Task 5: Note Templates — Integrate with New Note Command

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Add template import to extension.ts**

Add to imports at top of `src/extension.ts`:

```typescript
import { discoverTemplates, loadTemplateContent, expandTemplateVariables } from './templates';
```

- [ ] **Step 2: Modify the newNote command to show template picker**

Replace the content of the `ai-notes.newNote` command handler (from `const workspaceFolders` through the `await vscode.workspace.fs.writeFile` call and before `const doc = await vscode.workspace.openTextDocument`) with:

```typescript
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }
        const rootDir = workspaceFolders[0].uri.fsPath;
        const draftsDir = path.join(rootDir, '_drafts');
        if (!fs.existsSync(draftsDir)) {
            fs.mkdirSync(draftsDir, { recursive: true });
        }

        // Template selection
        const templates = await discoverTemplates(context.extensionPath, rootDir);
        const items: vscode.QuickPickItem[] = [
            { label: 'Blank note', description: 'Start with an empty file' },
            ...templates.map(t => ({
                label: t.name,
                description: t.source === 'built-in' ? 'Built-in template' : 'Workspace template',
                detail: t.filePath,
            })),
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Choose a template for your new note',
        });
        if (!selected) { return; }

        let initialContent = '';
        if (selected.detail) {
            const raw = await loadTemplateContent(selected.detail);
            initialContent = expandTemplateVariables(raw);
        }

        const guid = uuidv4();
        const fileName = `${formatDateDDMMYYYY(Date.now())}_${guid}.md`;
        const filePath = path.join(draftsDir, fileName);
        const fileUri = vscode.Uri.file(filePath);

        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(initialContent, 'utf8'));
```

The rest of the command (opening the document, save listener) stays the same.

- [ ] **Step 3: Compile and verify no type errors**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Manual test**

1. Open a workspace in VS Code with the extension loaded
2. Run command "AI Notes: New Note"
3. Verify QuickPick appears with "Blank note", "meeting", "journal", "til"
4. Select "meeting" — verify the file opens with meeting template content and `{{date}}` expanded

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts
git commit -m "feat: integrate template picker into new note command"
```

---

## Task 6: Auto-classify on Save

**Files:**
- Create: `src/autoClassify.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Create the auto-classify module**

Create `src/autoClassify.ts`:

```typescript
import * as vscode from 'vscode';
import * as path from 'path';

export class AutoClassifyWatcher {
    private disposables: vscode.Disposable[] = [];
    private dismissed: Set<string> = new Set();
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private classifyCallback: (doc: vscode.TextDocument) => Promise<void>;

    constructor(
        private draftsDir: string,
        classifyCallback: (doc: vscode.TextDocument) => Promise<void>
    ) {
        this.classifyCallback = classifyCallback;
    }

    start(): void {
        const listener = vscode.workspace.onDidSaveTextDocument(doc => {
            this.onSave(doc);
        });
        this.disposables.push(listener);

        const closeListener = vscode.workspace.onDidCloseTextDocument(doc => {
            this.dismissed.delete(doc.uri.fsPath);
        });
        this.disposables.push(closeListener);
    }

    private onSave(doc: vscode.TextDocument): void {
        const filePath = doc.uri.fsPath;

        if (!filePath.startsWith(this.draftsDir)) { return; }
        if (!filePath.endsWith('.md')) { return; }

        const content = doc.getText().trim();
        if (content.length === 0) { return; }

        if (this.hasTags(content)) { return; }
        if (this.dismissed.has(filePath)) { return; }

        // Debounce: 5 seconds per file
        const existing = this.debounceTimers.get(filePath);
        if (existing) { return; }

        const timer = setTimeout(() => {
            this.debounceTimers.delete(filePath);
        }, 5000);
        this.debounceTimers.set(filePath, timer);

        this.showClassifyPrompt(doc);
    }

    private hasTags(content: string): boolean {
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) { return false; }
        return match[1].includes('tags:');
    }

    private async showClassifyPrompt(doc: vscode.TextDocument): Promise<void> {
        const action = await vscode.window.showInformationMessage(
            'Classify this note with AI?',
            'Yes',
            'Later'
        );

        if (action === 'Yes') {
            await this.classifyCallback(doc);
        } else {
            this.dismissed.add(doc.uri.fsPath);
        }
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
    }
}
```

- [ ] **Step 2: Extract classify logic from extension.ts into a reusable function**

Add the following function to `src/extension.ts` (before or after `promptUserForNoteMetadata`):

```typescript
async function classifyAndMoveNote(doc: vscode.TextDocument, rootDir: string): Promise<void> {
    const content = doc.getText();
    const yamlRegex = /^---\n(?:.*\n)*?---\n/;
    const cleanedContent = content.replace(yamlRegex, '');

    const existingFolders = await getAllFolders(rootDir, 3);
    const metadata = await generateNoteMetadata(cleanedContent, existingFolders);

    if (!metadata || !metadata.tags || !metadata.name || !metadata.path) {
        vscode.window.showErrorMessage('AI categorization failed, please try again.');
        return;
    }

    const userMetadata = await promptUserForNoteMetadata(metadata, existingFolders, rootDir);
    if (!userMetadata) { return; }

    const { tags, directory, name } = userMetadata;

    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }

    const formattedDate = formatDateDDMMYYYY(Date.now());
    const newFileName = `${name}_${formattedDate}.md`;
    const newFilePath = path.join(directory, newFileName);
    const newFileUri = vscode.Uri.file(newFilePath);

    await upsertFrontmatterKey(doc, 'tags', tags);
    await vscode.workspace.fs.rename(doc.uri, newFileUri, { overwrite: false });
    await vscode.window.showTextDocument(newFileUri);
}
```

- [ ] **Step 3: Register the auto-classify watcher in activate()**

Add import at top of `src/extension.ts`:

```typescript
import { AutoClassifyWatcher } from './autoClassify';
```

Add inside `activate()`, inside the `if (workspaceFolders)` block:

```typescript
    const draftsDir = path.join(workspaceFolders[0].uri.fsPath, '_drafts');
    const autoClassify = new AutoClassifyWatcher(draftsDir, async (doc) => {
        await classifyAndMoveNote(doc, workspaceFolders[0].uri.fsPath);
    });
    autoClassify.start();
    context.subscriptions.push(autoClassify);
```

- [ ] **Step 4: Remove the one-shot save listener from the newNote command**

In the `ai-notes.newNote` handler, remove the entire `saveListener` block (the `vscode.workspace.onDidSaveTextDocument` and `context.subscriptions.push(saveListener)` section). The persistent AutoClassifyWatcher now handles this.

- [ ] **Step 5: Compile and verify no type errors**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/autoClassify.ts src/extension.ts
git commit -m "feat: auto-classify notes on save in _drafts/ folder"
```

---

## Task 7: Backlinks Webview — Link Index

**Files:**
- Create: `src/backlinksWebview.ts`
- Create: `src/test/backlinks.test.ts`

- [ ] **Step 1: Write failing test for link extraction**

Create `src/test/backlinks.test.ts`:

```typescript
import * as assert from 'assert';
import { extractMarkdownLinks } from '../backlinksWebview';

suite('Backlinks', () => {
    test('extracts relative markdown links', () => {
        const content = 'See [my note](./other-note.md) and [ref](../docs/ref.md).';
        const links = extractMarkdownLinks(content);
        assert.deepStrictEqual(links, [
            { text: 'my note', href: './other-note.md' },
            { text: 'ref', href: '../docs/ref.md' },
        ]);
    });

    test('ignores absolute URLs', () => {
        const content = 'See [docs](https://example.com/page.md).';
        const links = extractMarkdownLinks(content);
        assert.deepStrictEqual(links, []);
    });

    test('ignores non-md links', () => {
        const content = 'See [img](./photo.png) and [note](./note.md).';
        const links = extractMarkdownLinks(content);
        assert.deepStrictEqual(links, [
            { text: 'note', href: './note.md' },
        ]);
    });

    test('handles multiple links on same line', () => {
        const content = '[a](a.md) and [b](b.md)';
        const links = extractMarkdownLinks(content);
        assert.deepStrictEqual(links, [
            { text: 'a', href: 'a.md' },
            { text: 'b', href: 'b.md' },
        ]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && npx vscode-test --run src/test/backlinks.test.ts`
Expected: FAIL with "Cannot find module '../backlinksWebview'"

- [ ] **Step 3: Implement the backlinks webview**

Create `src/backlinksWebview.ts`:

```typescript
import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';

export interface MarkdownLink {
    text: string;
    href: string;
}

export function extractMarkdownLinks(content: string): MarkdownLink[] {
    const regex = /\[([^\]]*)\]\(([^)]+\.md)\)/g;
    const links: MarkdownLink[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        const href = match[2];
        if (/^https?:\/\//.test(href)) { continue; }
        links.push({ text: match[1], href });
    }
    return links;
}

interface BacklinkEntry {
    fromFile: string;
    linkText: string;
}

export class BacklinksWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiNotesBacklinksWebView';
    private view?: vscode.WebviewView;
    private linkIndex: Map<string, BacklinkEntry[]> = new Map();
    private disposables: vscode.Disposable[] = [];
    private indexBuilt = false;

    constructor(private workspaceRoot: string) {}

    async initialize(): Promise<void> {
        await this.buildIndex();

        const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
        watcher.onDidChange(uri => this.rebuildIndex());
        watcher.onDidCreate(uri => this.rebuildIndex());
        watcher.onDidDelete(uri => this.rebuildIndex());
        this.disposables.push(watcher);

        vscode.window.onDidChangeActiveTextEditor(() => this.refresh(), null, this.disposables);
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

    private refresh(): void {
        if (!this.view) { return; }
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.md')) {
            this.view.webview.html = this.getHtml([]);
            return;
        }

        const currentFile = editor.document.uri.fsPath;
        const backlinks = this.linkIndex.get(currentFile) || [];
        this.view.webview.html = this.getHtml(backlinks);
    }

    private async buildIndex(): Promise<void> {
        this.linkIndex.clear();
        await this.walkAndIndex(this.workspaceRoot);
        this.indexBuilt = true;
    }

    private async rebuildIndex(): Promise<void> {
        await this.buildIndex();
        this.refresh();
    }

    private async walkAndIndex(dir: string): Promise<void> {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch { return; }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await this.walkAndIndex(fullPath);
            } else if (entry.name.endsWith('.md')) {
                try {
                    const content = await fsp.readFile(fullPath, 'utf8');
                    const links = extractMarkdownLinks(content);
                    for (const link of links) {
                        const targetPath = path.resolve(path.dirname(fullPath), link.href);
                        const existing = this.linkIndex.get(targetPath) || [];
                        existing.push({ fromFile: fullPath, linkText: link.text });
                        this.linkIndex.set(targetPath, existing);
                    }
                } catch {}
            }
        }
    }

    private getHtml(backlinks: BacklinkEntry[]): string {
        if (backlinks.length === 0) {
            return `<body style="font-family: var(--vscode-font-family); color: var(--vscode-sideBar-foreground); padding: 12px;">
                <i>No backlinks found.</i>
            </body>`;
        }
        const items = backlinks.map(b => {
            const name = path.basename(b.fromFile);
            return `<div class="backlink" data-path="${b.fromFile}" style="cursor:pointer; padding:4px 8px; border-radius:3px; margin:2px 0;">
                <span style="color:var(--vscode-textLink-foreground);">${name}</span>
                <span style="opacity:0.7; font-size:0.9em;"> — "${b.linkText}"</span>
            </div>`;
        }).join('');

        return `<body style="font-family: var(--vscode-font-family); color: var(--vscode-sideBar-foreground); padding: 12px;">
            <div style="font-weight:bold; margin-bottom:8px;">Backlinks (${backlinks.length})</div>
            ${items}
            <script>
                const vscode = acquireVsCodeApi();
                document.querySelectorAll('.backlink').forEach(el => {
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
        this.disposables.forEach(d => d.dispose());
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && npx vscode-test --run src/test/backlinks.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/backlinksWebview.ts src/test/backlinks.test.ts
git commit -m "feat: add backlinks webview with link index"
```

---

## Task 8: Backlinks Webview — Register in Extension

**Files:**
- Modify: `package.json`
- Modify: `src/extension.ts`

- [ ] **Step 1: Add webview view to package.json**

In `package.json`, inside `contributes.views.explorer`, add after the existing `aiNotesByTagWebView` entry:

```json
{
    "id": "aiNotesBacklinksWebView",
    "name": "AI Notes Backlinks",
    "type": "webview"
}
```

- [ ] **Step 2: Register the backlinks provider in extension.ts**

Add import at top:

```typescript
import { BacklinksWebviewProvider } from './backlinksWebview';
```

Add inside `activate()`, inside the `if (workspaceFolders)` block:

```typescript
    const backlinksProvider = new BacklinksWebviewProvider(workspaceFolders[0].uri.fsPath);
    backlinksProvider.initialize();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            BacklinksWebviewProvider.viewType,
            backlinksProvider
        )
    );
    context.subscriptions.push(backlinksProvider);
```

- [ ] **Step 3: Compile and verify**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add package.json src/extension.ts
git commit -m "feat: register backlinks webview in extension"
```

---

## Task 9: Bulk Reclassify — Add Selection UI to Tag Webview

**Files:**
- Modify: `src/notesByTagWebview.ts`

- [ ] **Step 1: Add checkbox HTML and selection state to the webview**

In `src/notesByTagWebview.ts`, modify the `getHtmlForWebview` method.

Add to the `<style>` block:

```css
.note-checkbox {
    margin-right: 6px;
    cursor: pointer;
}
#bulkReclassify {
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
#bulkReclassify:hover {
    background: var(--vscode-button-hoverBackground);
}
#selectAll, #deselectAll {
    background: none;
    color: var(--vscode-textLink-foreground);
    border: none;
    font-size: 0.85em;
    cursor: pointer;
    padding: 2px 6px;
    display: none;
}
```

Add a button in the filter-bar div, after the refresh button:

```html
<button id="bulkReclassify" title="Reclassify selected notes" style="margin-left:8px;">Reclassify Selected (<span id="selCount">0</span>)</button>
<button id="selectAll" style="margin-left:4px;">Select All</button>
<button id="deselectAll" style="margin-left:2px;">Deselect All</button>
```

Modify the note div template to include a checkbox:

```html
<div class="note" data-path="${note}">
    <input type="checkbox" class="note-checkbox" data-path="${note}" />
    ${path.basename(note)}
</div>
```

Add to the `<script>` block:

```javascript
const selectedNotes = new Set();

function updateSelectionUI() {
    const count = selectedNotes.size;
    document.getElementById('selCount').textContent = count;
    document.getElementById('bulkReclassify').style.display = count > 0 ? 'inline-block' : 'none';
    document.getElementById('selectAll').style.display = 'inline-block';
    document.getElementById('deselectAll').style.display = count > 0 ? 'inline-block' : 'none';
}

document.querySelectorAll('.note-checkbox').forEach(function(cb) {
    cb.addEventListener('change', function(e) {
        e.stopPropagation();
        const notePath = cb.getAttribute('data-path');
        if (cb.checked) {
            selectedNotes.add(notePath);
        } else {
            selectedNotes.delete(notePath);
        }
        updateSelectionUI();
    });
});

document.querySelectorAll('.note-checkbox').forEach(function(cb) {
    cb.parentElement.addEventListener('click', function(e) {
        if (e.target === cb) { return; }
        vscode.postMessage({ command: 'openNote', path: cb.getAttribute('data-path') });
    });
});

document.getElementById('selectAll').addEventListener('click', function() {
    document.querySelectorAll('.note-checkbox').forEach(function(cb) {
        cb.checked = true;
        selectedNotes.add(cb.getAttribute('data-path'));
    });
    updateSelectionUI();
});

document.getElementById('deselectAll').addEventListener('click', function() {
    document.querySelectorAll('.note-checkbox').forEach(function(cb) {
        cb.checked = false;
    });
    selectedNotes.clear();
    updateSelectionUI();
});

document.getElementById('bulkReclassify').addEventListener('click', function() {
    vscode.postMessage({ command: 'bulkReclassify', paths: Array.from(selectedNotes) });
});

updateSelectionUI();
```

- [ ] **Step 2: Remove the old click handler for `.note` elements**

Remove the existing:
```javascript
document.querySelectorAll('.note').forEach(function(el) {
    el.addEventListener('click', function() {
        vscode.postMessage({ command: 'openNote', path: el.getAttribute('data-path') });
    });
});
```
This is replaced by the new handler above that checks whether the click was on the checkbox.

- [ ] **Step 3: Compile and verify**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/notesByTagWebview.ts
git commit -m "feat: add selection checkboxes and bulk reclassify button to tag webview"
```

---

## Task 10: Bulk Reclassify — Backend Logic

**Files:**
- Modify: `src/notesByTagWebview.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Handle the bulkReclassify message in the webview provider**

In `src/notesByTagWebview.ts`, in the `resolveWebviewView` method's `onDidReceiveMessage` handler, add:

```typescript
if (message.command === 'bulkReclassify') {
    const paths: string[] = message.paths;
    if (this.onBulkReclassify) {
        this.onBulkReclassify(paths);
    }
}
```

Add a public callback property to the class:

```typescript
public onBulkReclassify?: (paths: string[]) => void;
```

- [ ] **Step 2: Implement bulk reclassify logic in extension.ts**

Add the following function to `src/extension.ts`:

```typescript
async function bulkReclassifyNotes(paths: string[], rootDir: string): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Bulk Reclassify',
            cancellable: true,
        },
        async (progress, token) => {
            for (let i = 0; i < paths.length; i++) {
                if (token.isCancellationRequested) { break; }

                const notePath = paths[i];
                progress.report({
                    message: `Processing ${i + 1} of ${paths.length}: ${path.basename(notePath)}`,
                    increment: (1 / paths.length) * 100,
                });

                try {
                    const doc = await vscode.workspace.openTextDocument(notePath);
                    await classifyAndMoveNote(doc, rootDir);
                } catch (err: any) {
                    const action = await vscode.window.showWarningMessage(
                        `Failed to classify ${path.basename(notePath)}: ${err.message}`,
                        'Continue',
                        'Stop'
                    );
                    if (action === 'Stop') { break; }
                }
            }
        }
    );
}
```

- [ ] **Step 3: Wire up the callback when registering the webview provider**

In `src/extension.ts`, where the `NotesByTagWebviewProvider` is instantiated, set the callback:

```typescript
    const notesByTagProvider = new NotesByTagWebviewProvider(workspaceFolders[0].uri.fsPath);
    notesByTagProvider.onBulkReclassify = (paths) => {
        bulkReclassifyNotes(paths, workspaceFolders[0].uri.fsPath);
    };
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            NotesByTagWebviewProvider.viewType,
            notesByTagProvider
        )
    );
```

Replace the existing provider registration that uses `new NotesByTagWebviewProvider(...)` inline.

- [ ] **Step 4: Compile and verify**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 5: Manual test**

1. Open a workspace with several tagged notes
2. In the "AI Notes by Tag" panel, check 2-3 notes
3. Click "Reclassify Selected"
4. Verify progress notification appears and AI classification prompts fire for each note

- [ ] **Step 6: Commit**

```bash
git add src/notesByTagWebview.ts src/extension.ts
git commit -m "feat: implement bulk reclassify backend with progress tracking"
```

---

## Summary

| Task | Feature | Effort |
|------|---------|--------|
| 1 | Tag cache module | Small |
| 2 | Tag completion provider | Small |
| 3 | Built-in templates | Trivial |
| 4 | Template discovery/expansion | Small |
| 5 | Template integration in newNote | Small |
| 6 | Auto-classify on save | Medium |
| 7 | Backlinks link index | Medium |
| 8 | Backlinks registration | Trivial |
| 9 | Bulk reclassify UI | Medium |
| 10 | Bulk reclassify backend | Medium |

Total: ~10 focused tasks, each independently committable and testable.
