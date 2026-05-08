# Restructure Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `AI Notes: Restructure Vault` command that proposes a refined folder structure for the entire vault, applies the changes after one user confirmation, and rewrites internal links so they remain valid.

**Architecture:** Single LLM call returns a JSON `RestructurePlan` of folder renames, folder merges, and note moves. The plan is validated against current vault state, summarized for one-shot user confirmation, then applied in three phases: (A) compute path map, (B) filesystem mutations in safe order, (C) link-rewriting sweep. A separate pure module handles link rewriting to keep the markdown-edge-case logic testable in isolation.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode`), Node `fs/promises`, mocha + `@vscode/test-cli` (existing test harness), esbuild (existing build), existing `chatCompletionWithRetry` from `src/ai.ts`.

**Spec:** `docs/superpowers/specs/2026-05-08-restructure-vault-design.md`

---

## File Structure

**New files:**
- `src/restructureVault.ts` — orchestrator. Exports `restructureVault(rootDir)` and an internal-but-exported `validatePlan` for testing.
- `src/linkRewriter.ts` — pure link-rewriting functions. Exports `rewriteLinks` (pure) and `rewriteAllLinks` (filesystem walker).
- `src/test/linkRewriter.test.ts` — table-driven tests for link rewriting.
- `src/test/restructureVault.test.ts` — tests for `validatePlan` plus one end-to-end integration test.

**Modified files:**
- `src/extension.ts` — register the new command (~10 lines after line 526).
- `package.json` — add the new command contribution (~4 lines under `contributes.commands`).

**Conventions to follow (from existing codebase):**
- Tests use `suite('Name', () => { test('...', () => { ... }) })` with `assert.strictEqual` from `'assert'`.
- Module pattern: one feature per file, exports named functions.
- AI calls go through `chatCompletionWithRetry` from `src/ai.ts`.
- JSON parsing of AI responses follows the try/catch + regex-fallback pattern from `src/ai.ts:34-58`.
- Folder enumeration uses `getAllFolders` from `src/files.ts`.

---

## Task 1: Skeleton command registration (no logic yet)

**Files:**
- Create: `src/restructureVault.ts`
- Modify: `src/extension.ts` (add import and command registration after line 526)
- Modify: `package.json` (add command entry)

- [ ] **Step 1: Create skeleton `src/restructureVault.ts`**

```ts
import * as vscode from 'vscode';

export async function restructureVault(rootDir: string): Promise<void> {
    vscode.window.showInformationMessage(`Restructure Vault: not yet implemented (root: ${rootDir})`);
}
```

- [ ] **Step 2: Add command registration to `src/extension.ts`**

Add to the imports section (near line 25):

```ts
import { restructureVault } from './restructureVault';
```

Add immediately after line 526 (after `context.subscriptions.push(exportSiteDisposable);` and before the closing `}` of `activate`):

```ts
    const restructureVaultDisposable = vscode.commands.registerCommand('ai-notes.restructureVault', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }
        try {
            await restructureVault(workspaceFolders[0].uri.fsPath);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Restructure failed: ${err.message}`);
        }
    });
    context.subscriptions.push(restructureVaultDisposable);
```

- [ ] **Step 3: Add command contribution to `package.json`**

In the `contributes.commands` array (currently ends after the `ai-notes.exportSite` entry around line 141), add:

```json
,
{
  "command": "ai-notes.restructureVault",
  "title": "AI Notes: Restructure Vault"
}
```

- [ ] **Step 4: Verify the build still passes**

Run: `npm run compile`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/restructureVault.ts src/extension.ts package.json
git commit -m "feat(restructure): scaffold restructure-vault command"
```

---

## Task 2: Define core types and `validatePlan` (TDD)

**Files:**
- Modify: `src/restructureVault.ts` (add types + validatePlan)
- Create: `src/test/restructureVault.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/test/restructureVault.test.ts`:

```ts
import * as assert from 'assert';
import { validatePlan, RestructurePlan, VaultState } from '../restructureVault';

const baseState: VaultState = {
    notes: new Set(['notes/a.md', 'notes/b.md', 'archive/c.md']),
    folders: new Set(['notes', 'archive']),
};

suite('validatePlan', () => {
    test('accepts an empty plan', () => {
        const plan: RestructurePlan = { operations: [] };
        const result = validatePlan(plan, baseState);
        assert.strictEqual(result.ok, true);
    });

    test('accepts a valid mix of operations', () => {
        const plan: RestructurePlan = {
            operations: [
                { kind: 'rename', from: 'archive', to: 'old' },
                { kind: 'move', notePath: 'notes/a.md', toFolder: 'notes/sub' },
            ],
        };
        const result = validatePlan(plan, baseState);
        assert.strictEqual(result.ok, true);
    });

    test('rejects rename of a folder that does not exist', () => {
        const plan: RestructurePlan = {
            operations: [{ kind: 'rename', from: 'ghost', to: 'gone' }],
        };
        const result = validatePlan(plan, baseState);
        assert.strictEqual(result.ok, false);
        assert.match(result.error!, /ghost/);
    });

    test('rejects move of a note that does not exist', () => {
        const plan: RestructurePlan = {
            operations: [{ kind: 'move', notePath: 'notes/ghost.md', toFolder: 'archive' }],
        };
        const result = validatePlan(plan, baseState);
        assert.strictEqual(result.ok, false);
        assert.match(result.error!, /ghost\.md/);
    });

    test('rejects two operations producing the same destination', () => {
        const plan: RestructurePlan = {
            operations: [
                { kind: 'rename', from: 'notes', to: 'merged' },
                { kind: 'rename', from: 'archive', to: 'merged' },
            ],
        };
        const result = validatePlan(plan, baseState);
        assert.strictEqual(result.ok, false);
        assert.match(result.error!, /conflicting|duplicate|same destination/i);
    });

    test('rejects renaming a folder into one of its own descendants', () => {
        const stateWithNested: VaultState = {
            notes: new Set(['a/b/c.md']),
            folders: new Set(['a', 'a/b']),
        };
        const plan: RestructurePlan = {
            operations: [{ kind: 'rename', from: 'a', to: 'a/b/c' }],
        };
        const result = validatePlan(plan, stateWithNested);
        assert.strictEqual(result.ok, false);
        assert.match(result.error!, /descendant|cycle|invalid/i);
    });

    test('rejects merge with non-existent source folder', () => {
        const plan: RestructurePlan = {
            operations: [{ kind: 'merge', from: 'ghost', into: 'notes' }],
        };
        const result = validatePlan(plan, baseState);
        assert.strictEqual(result.ok, false);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: compile error or 7 failures referring to `validatePlan`, `RestructurePlan`, `VaultState` not exported.

- [ ] **Step 3: Implement types and `validatePlan` in `src/restructureVault.ts`**

Replace the file contents with:

```ts
import * as vscode from 'vscode';

// ---------- Types ----------

export type FolderRename = { kind: 'rename'; from: string; to: string };
// Merge: move every note from `from` into `into`, then remove `from` if empty.
export type FolderMerge = { kind: 'merge'; from: string; into: string };
export type NoteMove = { kind: 'move'; notePath: string; toFolder: string };
export type Operation = FolderRename | FolderMerge | NoteMove;

export type RestructurePlan = {
    operations: Operation[];
    rationale?: string;
};

export type VaultState = {
    notes: Set<string>;   // relative paths, forward slashes, e.g. "notes/a.md"
    folders: Set<string>; // relative paths, forward slashes, e.g. "notes/sub"
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

// ---------- validatePlan ----------

export function validatePlan(plan: RestructurePlan, state: VaultState): ValidationResult {
    const destinations: string[] = [];

    for (const op of plan.operations) {
        if (op.kind === 'rename') {
            if (!state.folders.has(op.from)) {
                return { ok: false, error: `Folder '${op.from}' does not exist.` };
            }
            if (op.to === op.from) {
                return { ok: false, error: `Rename of '${op.from}' is a no-op.` };
            }
            if (op.to.startsWith(op.from + '/')) {
                return { ok: false, error: `Cannot rename '${op.from}' into its own descendant '${op.to}'.` };
            }
            destinations.push(op.to);
        } else if (op.kind === 'merge') {
            if (!state.folders.has(op.from)) {
                return { ok: false, error: `Merge source folder '${op.from}' does not exist.` };
            }
            if (op.into.startsWith(op.from + '/')) {
                return { ok: false, error: `Cannot merge '${op.from}' into its own descendant '${op.into}'.` };
            }
        } else if (op.kind === 'move') {
            if (!state.notes.has(op.notePath)) {
                return { ok: false, error: `Note '${op.notePath}' does not exist.` };
            }
        }
    }

    // Duplicate destinations check (ignoring merge-into, since multiple merges into the same target are valid).
    const seen = new Set<string>();
    for (const dest of destinations) {
        if (seen.has(dest)) {
            return { ok: false, error: `Multiple operations have the same destination '${dest}' (conflicting renames).` };
        }
        seen.add(dest);
    }

    return { ok: true };
}

// ---------- Orchestrator stub (filled in later tasks) ----------

export async function restructureVault(rootDir: string): Promise<void> {
    vscode.window.showInformationMessage(`Restructure Vault: not yet implemented (root: ${rootDir})`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: all 7 `validatePlan` tests pass. Other suites unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/restructureVault.ts src/test/restructureVault.test.ts
git commit -m "feat(restructure): add core types and validatePlan with tests"
```

---

## Task 3: Implement `linkRewriter.rewriteLinks` for wiki-links (TDD)

**Files:**
- Create: `src/linkRewriter.ts`
- Create: `src/test/linkRewriter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/test/linkRewriter.test.ts`:

```ts
import * as assert from 'assert';
import { rewriteLinks } from '../linkRewriter';

// All paths are POSIX-style (forward slashes) for these tests.
// rewriteLinks normalizes its inputs so callers can pass either separator.

suite('linkRewriter wiki-links', () => {
    test('rewrites a simple wiki-link when target moved', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = 'See [[foo]] for details.';
        const result = rewriteLinks(content, '/v/notes/host.md', '/v', pathMap);
        // Basename unchanged (foo.md → foo.md), so the wiki text stays the same.
        assert.strictEqual(result, 'See [[foo]] for details.');
    });

    test('preserves alias when wiki-link has one', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = 'See [[foo|the foo doc]].';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, 'See [[foo|the foo doc]].');
    });

    test('leaves wiki-link unchanged when target not in pathMap', () => {
        const pathMap = new Map<string, string>();
        const content = 'See [[bar]] over there.';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, 'See [[bar]] over there.');
    });

    test('does not rewrite wiki-links inside fenced code blocks', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = '```\n[[foo]]\n```\nReal: [[foo]]';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        // Both links target the same file with same basename, so visually unchanged,
        // but the fenced one must not be touched even structurally — assert exact equality.
        assert.strictEqual(result, '```\n[[foo]]\n```\nReal: [[foo]]');
    });

    test('does not rewrite wiki-links inside inline code', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = 'Use `[[foo]]` syntax. Then [[foo]] for real.';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, 'Use `[[foo]]` syntax. Then [[foo]] for real.');
    });

    test('returns content unchanged for empty pathMap', () => {
        const pathMap = new Map<string, string>();
        const content = 'Plenty of [[wiki]] [[links]] here.';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, content);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: compile error — `linkRewriter` module not found / `rewriteLinks` not exported.

- [ ] **Step 3: Create `src/linkRewriter.ts` with `rewriteLinks`**

```ts
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Rewrite internal links in `content` based on `pathMap` (oldAbsPath → newAbsPath).
 * Pure function — no I/O. Skips fenced code blocks and inline code.
 *
 * @param content     The note's markdown content.
 * @param noteAbsPath The note's absolute path BEFORE moves are applied (used to resolve relative links).
 * @param vaultRoot   The vault root absolute path.
 * @param pathMap     Map of old absolute path → new absolute path, for files that moved.
 */
export function rewriteLinks(
    content: string,
    noteAbsPath: string,
    vaultRoot: string,
    pathMap: Map<string, string>
): string {
    if (pathMap.size === 0) { return content; }

    // Normalize a path to POSIX-style for stable map lookups.
    const norm = (p: string) => p.split(path.sep).join('/');
    const normalizedMap = new Map<string, string>();
    for (const [k, v] of pathMap) {
        normalizedMap.set(norm(k), norm(v));
    }

    // Build a basename → newAbsPath map for wiki-links.
    const basenameToNew = new Map<string, string>();
    for (const [oldPath, newPath] of normalizedMap) {
        const base = oldPath.split('/').pop()!.replace(/\.md$/, '');
        basenameToNew.set(base, newPath);
    }

    // Tokenize content into segments where rewriting is allowed vs forbidden (code).
    // Strategy: split on fenced code blocks and inline code, rewrite only the "prose" segments.
    const segments = splitProseAndCode(content);
    const out = segments.map(seg => {
        if (seg.kind === 'code') { return seg.text; }
        return rewriteWikiLinksInProse(seg.text, basenameToNew);
    });
    return out.join('');
}

// ---------- Internal helpers ----------

type Segment = { kind: 'prose' | 'code'; text: string };

function splitProseAndCode(content: string): Segment[] {
    // Match (in order): fenced code blocks (```...```), inline code (`...`).
    const segments: Segment[] = [];
    const re = /(```[\s\S]*?```|`[^`\n]*`)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
        if (m.index > last) {
            segments.push({ kind: 'prose', text: content.slice(last, m.index) });
        }
        segments.push({ kind: 'code', text: m[0] });
        last = m.index + m[0].length;
    }
    if (last < content.length) {
        segments.push({ kind: 'prose', text: content.slice(last) });
    }
    return segments;
}

function rewriteWikiLinksInProse(text: string, basenameToNew: Map<string, string>): string {
    // Match [[name]] or [[name|alias]]. Capture name and optional alias.
    return text.replace(/\[\[([^\[\]\|]+)(?:\|([^\[\]]+))?\]\]/g, (full, name: string, alias?: string) => {
        const trimmed = name.trim();
        if (!basenameToNew.has(trimmed)) { return full; }
        // Basename is preserved across moves in our flow — wiki-link text doesn't need to change.
        // (The link still resolves because the basename is unique in the vault.)
        return full;
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: all 6 wiki-link tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/linkRewriter.ts src/test/linkRewriter.test.ts
git commit -m "feat(restructure): add linkRewriter with wiki-link support"
```

---

## Task 4: Extend `linkRewriter` for markdown links and images (TDD)

**Files:**
- Modify: `src/linkRewriter.ts`
- Modify: `src/test/linkRewriter.test.ts`

- [ ] **Step 1: Add failing tests for markdown links**

Append to `src/test/linkRewriter.test.ts`:

```ts
suite('linkRewriter markdown links', () => {
    test('rewrites relative markdown link when target moved', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        // Host note did not move; it sits at /v/host.md.
        // Old link points to /v/old/foo.md — must now point to /v/new/foo.md.
        const content = 'See [the foo](old/foo.md) for details.';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, 'See [the foo](new/foo.md) for details.');
    });

    test('preserves anchor fragment when rewriting markdown link', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = 'See [the foo](old/foo.md#section-2).';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, 'See [the foo](new/foo.md#section-2).');
    });

    test('recomputes relative path when host note also moved', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
            ['/v/notes/host.md', '/v/archive/host.md'],
        ]);
        const content = 'See [foo](../old/foo.md).';
        // Host moves /v/notes/host.md → /v/archive/host.md.
        // Target moves /v/old/foo.md → /v/new/foo.md.
        // New relative path from /v/archive/host.md → /v/new/foo.md is "../new/foo.md".
        const result = rewriteLinks(content, '/v/notes/host.md', '/v', pathMap);
        assert.strictEqual(result, 'See [foo](../new/foo.md).');
    });

    test('leaves absolute URLs unchanged', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = 'See [external](https://example.com/page).';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, content);
    });

    test('rewrites image links the same way', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/img.png', '/v/new/img.png'],
        ]);
        const content = '![alt](old/img.png)';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, '![alt](new/img.png)');
    });

    test('does not rewrite markdown links inside fenced code', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = '```\n[x](old/foo.md)\n```';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, content);
    });

    test('leaves link to file not in pathMap unchanged', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = 'See [bar](other/bar.md).';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, content);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: 7 new failures — markdown link rewriting not yet implemented.

- [ ] **Step 3: Extend `rewriteLinks` to handle markdown and image links**

In `src/linkRewriter.ts`, replace the `rewriteWikiLinksInProse` function with a combined rewriter, and update the call site in `rewriteLinks`.

Replace the body of `rewriteLinks` after the `splitProseAndCode` line with:

```ts
    const noteAbsPosix = norm(noteAbsPath);
    const out = segments.map(seg => {
        if (seg.kind === 'code') { return seg.text; }
        let s = rewriteWikiLinksInProse(seg.text, basenameToNew);
        s = rewriteMarkdownLinksInProse(s, noteAbsPosix, normalizedMap);
        return s;
    });
    return out.join('');
```

Add after `rewriteWikiLinksInProse`:

```ts
function rewriteMarkdownLinksInProse(
    text: string,
    hostOldAbs: string,
    pathMap: Map<string, string>
): string {
    // Match `[text](target)` and `![alt](target)`. Target may include #anchor.
    // We deliberately DO NOT match angle-bracket forms `<...>` — keep the regex simple.
    return text.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (full, bang: string, label: string, target: string) => {
        // Skip absolute URLs and fragment-only links.
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) { return full; }

        // Split target into path + #anchor.
        const hashIdx = target.indexOf('#');
        const rawPath = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
        const anchor = hashIdx >= 0 ? target.slice(hashIdx) : '';

        // Resolve relative path against the host note's OLD absolute path (so existing links resolve).
        const hostOldDir = hostOldAbs.split('/').slice(0, -1).join('/');
        const targetOldAbs = posixResolve(hostOldDir, rawPath);

        const targetNewAbs = pathMap.get(targetOldAbs);
        // Determine the host's NEW directory: if host moved, use new; else keep old dir.
        const hostNewAbs = pathMap.get(hostOldAbs) ?? hostOldAbs;
        const hostNewDir = hostNewAbs.split('/').slice(0, -1).join('/');

        if (!targetNewAbs) {
            // Target didn't move. If host didn't move either, leave link as-is.
            if (hostNewDir === hostOldDir) { return full; }
            // Host moved but target didn't: recompute the relative path from host's new dir.
            const newRel = posixRelative(hostNewDir, targetOldAbs);
            return `${bang}[${label}](${newRel}${anchor})`;
        }

        // Target moved. Recompute relative path from host's (possibly new) dir to target's new path.
        const newRel = posixRelative(hostNewDir, targetNewAbs);
        return `${bang}[${label}](${newRel}${anchor})`;
    });
}

// POSIX-only path helpers (no Windows backslashes — we normalize at the boundary).

function posixResolve(baseDir: string, rel: string): string {
    const baseParts = baseDir.split('/').filter(p => p.length > 0);
    const relParts = rel.split('/');
    const stack: string[] = baseParts.slice();
    for (const part of relParts) {
        if (part === '' || part === '.') { continue; }
        if (part === '..') { stack.pop(); continue; }
        stack.push(part);
    }
    return '/' + stack.join('/');
}

function posixRelative(fromDir: string, toAbs: string): string {
    const fromParts = fromDir.split('/').filter(p => p.length > 0);
    const toParts = toAbs.split('/').filter(p => p.length > 0);
    let common = 0;
    while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
        common++;
    }
    const up = fromParts.length - common;
    const down = toParts.slice(common);
    const segments = [...Array(up).fill('..'), ...down];
    if (segments.length === 0) { return '.'; }
    return segments.join('/');
}
```

The unused `fs` import at the top of `src/linkRewriter.ts` is acceptable for now — it will be used in Task 5. If lint complains, leave it; otherwise no action needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: all 13 linkRewriter tests pass (6 wiki-link + 7 markdown).

- [ ] **Step 5: Commit**

```bash
git add src/linkRewriter.ts src/test/linkRewriter.test.ts
git commit -m "feat(restructure): handle markdown links and images in linkRewriter"
```

---

## Task 5: Implement `rewriteAllLinks` (filesystem walker)

**Files:**
- Modify: `src/linkRewriter.ts`

- [ ] **Step 1: Add the walker function**

Append to `src/linkRewriter.ts`:

```ts
/**
 * Walk the vault, rewriting links in every .md file according to pathMap.
 * Writes back only files that changed. Returns the count of notes that were modified.
 * Per-file errors are caught and counted in `failures` — they do not abort the sweep.
 */
export async function rewriteAllLinks(
    vaultRoot: string,
    pathMap: Map<string, string>
): Promise<{ rewritten: number; failures: { path: string; error: string }[] }> {
    if (pathMap.size === 0) { return { rewritten: 0, failures: [] }; }

    const failures: { path: string; error: string }[] = [];
    let rewritten = 0;

    const allMd = await listMarkdownFiles(vaultRoot);
    for (const absPath of allMd) {
        try {
            const content = await fs.readFile(absPath, 'utf8');
            // Note: absPath is the note's CURRENT (post-move) location.
            // For link rewriting we need the note's OLD absolute path so relative links resolve.
            // pathMap maps oldAbs → newAbs. Build a reverse lookup once per call.
            // For notes that didn't move, their old path == current path.
            const reverseMap = buildReverseMap(pathMap);
            const oldAbsPath = reverseMap.get(absPath) ?? absPath;
            const updated = rewriteLinks(content, oldAbsPath, vaultRoot, pathMap);
            if (updated !== content) {
                await fs.writeFile(absPath, updated, 'utf8');
                rewritten++;
            }
        } catch (err: any) {
            failures.push({ path: absPath, error: err.message ?? String(err) });
        }
    }
    return { rewritten, failures };
}

async function listMarkdownFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    async function walk(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.')) { continue; }
            if (entry.name === 'node_modules') { continue; }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                out.push(full);
            }
        }
    }
    await walk(root);
    return out;
}

function buildReverseMap(pathMap: Map<string, string>): Map<string, string> {
    const reverse = new Map<string, string>();
    for (const [oldAbs, newAbs] of pathMap) {
        reverse.set(newAbs, oldAbs);
    }
    return reverse;
}
```

- [ ] **Step 2: Verify the build still passes**

Run: `npm run compile`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 3: Run all tests to confirm nothing regressed**

Run: `npm run test`
Expected: all existing tests still pass (no new tests added in this task — `rewriteAllLinks` is exercised by the integration test in Task 9).

- [ ] **Step 4: Commit**

```bash
git add src/linkRewriter.ts
git commit -m "feat(restructure): add rewriteAllLinks vault-walker"
```

---

## Task 6: Implement `gatherNotes` (read vault state)

**Files:**
- Modify: `src/restructureVault.ts`
- Modify: `src/test/restructureVault.test.ts`

- [ ] **Step 1: Add failing test**

Append to `src/test/restructureVault.test.ts`:

```ts
import { gatherNotes, NoteEntry } from '../restructureVault';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

suite('gatherNotes', () => {
    test('reads markdown files and parses tags from frontmatter', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aint-'));
        try {
            await fs.mkdir(path.join(tmp, 'notes'), { recursive: true });
            await fs.writeFile(
                path.join(tmp, 'notes', 'a.md'),
                '---\ntags: [foo, bar]\n---\nBody A'
            );
            await fs.writeFile(
                path.join(tmp, 'notes', 'b.md'),
                'No frontmatter, just body B.'
            );
            const notes = await gatherNotes(tmp, false);
            // Sort for deterministic comparison.
            notes.sort((x, y) => x.relPath.localeCompare(y.relPath));
            assert.strictEqual(notes.length, 2);
            assert.strictEqual(notes[0].relPath, 'notes/a.md');
            assert.deepStrictEqual(notes[0].tags, ['foo', 'bar']);
            assert.strictEqual(notes[0].title, 'a');
            assert.strictEqual(notes[1].relPath, 'notes/b.md');
            assert.deepStrictEqual(notes[1].tags, []);
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });

    test('includes preview when detailed=true', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aint-'));
        try {
            await fs.writeFile(
                path.join(tmp, 'a.md'),
                '---\ntags: [t]\n---\nThis is the body content for preview testing.'
            );
            const notes = await gatherNotes(tmp, true);
            assert.strictEqual(notes.length, 1);
            assert.ok(notes[0].preview);
            assert.ok(notes[0].preview!.startsWith('This is the body'));
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });

    test('skips dotfiles and node_modules', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aint-'));
        try {
            await fs.mkdir(path.join(tmp, '.hidden'), { recursive: true });
            await fs.mkdir(path.join(tmp, 'node_modules'), { recursive: true });
            await fs.writeFile(path.join(tmp, '.hidden', 'a.md'), 'body');
            await fs.writeFile(path.join(tmp, 'node_modules', 'b.md'), 'body');
            await fs.writeFile(path.join(tmp, 'real.md'), 'body');
            const notes = await gatherNotes(tmp, false);
            assert.strictEqual(notes.length, 1);
            assert.strictEqual(notes[0].relPath, 'real.md');
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: 3 failures referencing `gatherNotes` not exported.

- [ ] **Step 3: Implement `gatherNotes` and `NoteEntry`**

In `src/restructureVault.ts`, add the imports near the top:

```ts
import * as path from 'path';
import * as fs from 'fs/promises';
```

Add after the `ValidationResult` type:

```ts
export type NoteEntry = {
    relPath: string;       // POSIX-style, relative to vaultRoot
    title: string;         // basename without .md
    tags: string[];        // from YAML frontmatter
    preview?: string;      // first ~200 chars of body, only when detailed=true
};

export async function gatherNotes(rootDir: string, detailed: boolean): Promise<NoteEntry[]> {
    const out: NoteEntry[] = [];
    async function walk(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.')) { continue; }
            if (entry.name === 'node_modules') { continue; }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                const content = await fs.readFile(full, 'utf8');
                const { tags, body } = parseFrontmatter(content);
                const relPath = path.relative(rootDir, full).split(path.sep).join('/');
                const title = entry.name.replace(/\.md$/, '');
                const note: NoteEntry = { relPath, title, tags };
                if (detailed) {
                    note.preview = body.trim().slice(0, 200);
                }
                out.push(note);
            }
        }
    }
    await walk(rootDir);
    return out;
}

function parseFrontmatter(content: string): { tags: string[]; body: string } {
    const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) { return { tags: [], body: content }; }
    const yaml = m[1];
    const body = m[2];
    const tagsLine = yaml.split('\n').find(l => /^tags\s*:/.test(l));
    if (!tagsLine) { return { tags: [], body }; }
    // Two supported forms: "tags: [a, b]" or "tags: a, b".
    const valuePart = tagsLine.replace(/^tags\s*:\s*/, '').trim();
    const stripped = valuePart.replace(/^\[|\]$/g, '');
    const tags = stripped.split(',').map(t => t.trim()).filter(t => t.length > 0);
    return { tags, body };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: all 3 `gatherNotes` tests pass plus existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/restructureVault.ts src/test/restructureVault.test.ts
git commit -m "feat(restructure): add gatherNotes for vault scanning"
```

---

## Task 7: Implement prompt building and plan parsing

**Files:**
- Modify: `src/restructureVault.ts`
- Modify: `src/test/restructureVault.test.ts`

- [ ] **Step 1: Add failing tests for `parsePlan`**

Append to `src/test/restructureVault.test.ts`:

```ts
import { parsePlan } from '../restructureVault';

suite('parsePlan', () => {
    test('parses well-formed JSON response', () => {
        const response = JSON.stringify({
            operations: [
                { kind: 'rename', from: 'a', to: 'b' },
                { kind: 'move', notePath: 'a/x.md', toFolder: 'b' },
            ],
            rationale: 'tighter naming',
        });
        const plan = parsePlan(response);
        assert.strictEqual(plan.operations.length, 2);
        assert.strictEqual(plan.rationale, 'tighter naming');
    });

    test('extracts JSON from a response with surrounding text', () => {
        const response = 'Here is the plan:\n```json\n{"operations":[]}\n```\nThanks.';
        const plan = parsePlan(response);
        assert.strictEqual(plan.operations.length, 0);
    });

    test('throws on response with no JSON object', () => {
        assert.throws(() => parsePlan('just text, no json'));
    });

    test('throws on JSON missing operations array', () => {
        assert.throws(() => parsePlan('{"foo":"bar"}'));
    });

    test('filters operations with unknown kind', () => {
        const response = JSON.stringify({
            operations: [
                { kind: 'rename', from: 'a', to: 'b' },
                { kind: 'delete', path: 'a/x.md' },
            ],
        });
        const plan = parsePlan(response);
        assert.strictEqual(plan.operations.length, 1);
        assert.strictEqual(plan.operations[0].kind, 'rename');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: 5 failures referencing `parsePlan` not exported.

- [ ] **Step 3: Implement `parsePlan` and `buildPrompt`**

In `src/restructureVault.ts`, add:

```ts
export function parsePlan(response: string): RestructurePlan {
    // Try direct JSON parse first; on failure, look for the first {...} block.
    let raw: any;
    try {
        raw = JSON.parse(response);
    } catch {
        const m = response.match(/\{[\s\S]*\}/);
        if (!m) { throw new Error('AI response contained no JSON object.'); }
        raw = JSON.parse(m[0]);
    }
    if (!raw || !Array.isArray(raw.operations)) {
        throw new Error('AI response missing operations array.');
    }
    const operations: Operation[] = [];
    for (const op of raw.operations) {
        if (!op || typeof op !== 'object') { continue; }
        if (op.kind === 'rename' && typeof op.from === 'string' && typeof op.to === 'string') {
            operations.push({ kind: 'rename', from: op.from, to: op.to });
        } else if (op.kind === 'merge' && typeof op.from === 'string' && typeof op.into === 'string') {
            operations.push({ kind: 'merge', from: op.from, into: op.into });
        } else if (op.kind === 'move' && typeof op.notePath === 'string' && typeof op.toFolder === 'string') {
            operations.push({ kind: 'move', notePath: op.notePath, toFolder: op.toFolder });
        }
    }
    const plan: RestructurePlan = { operations };
    if (typeof raw.rationale === 'string') { plan.rationale = raw.rationale; }
    return plan;
}

export function buildPrompt(notes: NoteEntry[], folders: string[]): string {
    const noteLines = notes.map(n => {
        const tags = n.tags.length > 0 ? `tags=[${n.tags.join(', ')}]` : 'tags=[]';
        const preview = n.preview ? ` preview="${n.preview.replace(/\n/g, ' ').replace(/"/g, "'").slice(0, 200)}"` : '';
        return `- ${n.relPath} ${tags}${preview}`;
    }).join('\n');

    const folderLines = folders.map(f => `- ${f}`).join('\n');

    return `You are reorganizing a markdown notes vault. Refine the existing folder structure conservatively.

Rules:
- Propose changes ONLY when they materially improve organization.
- Do not invent folders for fewer than 2 notes.
- Do not move a note that is already in a sensible folder.
- Output strict JSON matching the schema below — no prose outside the JSON.

Allowed operation kinds:
- {"kind":"rename","from":"<existing folder>","to":"<new folder>"}
- {"kind":"merge","from":"<existing folder>","into":"<existing folder>"}
- {"kind":"move","notePath":"<existing note path>","toFolder":"<destination folder>"}

All paths are relative to the vault root and use forward slashes.

Schema:
{"operations":[...], "rationale":"<one-paragraph explanation>"}

Current folders:
${folderLines}

Current notes:
${noteLines}

Respond with ONLY the JSON object.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: all 5 `parsePlan` tests pass plus existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/restructureVault.ts src/test/restructureVault.test.ts
git commit -m "feat(restructure): add buildPrompt and parsePlan"
```

---

## Task 8: Implement `applyPlan` (path map + filesystem mutations)

**Files:**
- Modify: `src/restructureVault.ts`
- Modify: `src/test/restructureVault.test.ts`

- [ ] **Step 1: Add failing tests for `buildPathMap`**

Append to `src/test/restructureVault.test.ts`:

```ts
import { buildPathMap } from '../restructureVault';

suite('buildPathMap', () => {
    test('maps a renamed folder\'s notes to new paths', () => {
        const plan: RestructurePlan = {
            operations: [{ kind: 'rename', from: 'old', to: 'new' }],
        };
        const state: VaultState = {
            notes: new Set(['old/a.md', 'old/sub/b.md', 'other/c.md']),
            folders: new Set(['old', 'old/sub', 'other']),
        };
        const map = buildPathMap(plan, state, '/v');
        assert.strictEqual(map.get('/v/old/a.md'), '/v/new/a.md');
        assert.strictEqual(map.get('/v/old/sub/b.md'), '/v/new/sub/b.md');
        assert.strictEqual(map.has('/v/other/c.md'), false);
    });

    test('maps a moved note', () => {
        const plan: RestructurePlan = {
            operations: [{ kind: 'move', notePath: 'old/a.md', toFolder: 'new' }],
        };
        const state: VaultState = {
            notes: new Set(['old/a.md']),
            folders: new Set(['old', 'new']),
        };
        const map = buildPathMap(plan, state, '/v');
        assert.strictEqual(map.get('/v/old/a.md'), '/v/new/a.md');
    });

    test('maps a folder merge', () => {
        const plan: RestructurePlan = {
            operations: [{ kind: 'merge', from: 'a', into: 'b' }],
        };
        const state: VaultState = {
            notes: new Set(['a/x.md', 'a/y.md', 'b/z.md']),
            folders: new Set(['a', 'b']),
        };
        const map = buildPathMap(plan, state, '/v');
        assert.strictEqual(map.get('/v/a/x.md'), '/v/b/x.md');
        assert.strictEqual(map.get('/v/a/y.md'), '/v/b/y.md');
        assert.strictEqual(map.has('/v/b/z.md'), false);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: 3 failures referencing `buildPathMap` not exported.

- [ ] **Step 3: Implement `buildPathMap` and `applyPlan`**

In `src/restructureVault.ts`, add:

```ts
/**
 * Compute the absolute oldPath → newPath map for every note affected by `plan`.
 * Pure: no I/O. Path strings use forward slashes.
 */
export function buildPathMap(plan: RestructurePlan, state: VaultState, vaultRoot: string): Map<string, string> {
    const map = new Map<string, string>();
    const root = vaultRoot.replace(/\/+$/, '');

    // Renames: every note under `from/` moves to `to/<same-suffix>`.
    for (const op of plan.operations) {
        if (op.kind !== 'rename') { continue; }
        const fromPrefix = op.from + '/';
        for (const noteRel of state.notes) {
            if (noteRel === op.from + '/' || noteRel.startsWith(fromPrefix)) {
                const suffix = noteRel.slice(op.from.length);
                map.set(`${root}/${noteRel}`, `${root}/${op.to}${suffix}`);
            }
        }
    }

    // Merges: every note directly under `from/` (or any depth) moves to `into/<basename-or-subpath>`.
    for (const op of plan.operations) {
        if (op.kind !== 'merge') { continue; }
        const fromPrefix = op.from + '/';
        for (const noteRel of state.notes) {
            if (noteRel.startsWith(fromPrefix)) {
                const suffix = noteRel.slice(op.from.length); // "/sub/x.md" or "/x.md"
                map.set(`${root}/${noteRel}`, `${root}/${op.into}${suffix}`);
            }
        }
    }

    // Note moves: explicit single-note relocation, overrides any prior mapping for that note.
    for (const op of plan.operations) {
        if (op.kind !== 'move') { continue; }
        const basename = op.notePath.split('/').pop()!;
        map.set(`${root}/${op.notePath}`, `${root}/${op.toFolder}/${basename}`);
    }

    return map;
}

/**
 * Apply the plan to the filesystem. Caller must have validated the plan first.
 * Order: folder renames → folder merges → note moves. Stops on first error.
 * Returns counts and any error encountered.
 */
export async function applyPlan(plan: RestructurePlan, vaultRoot: string): Promise<{
    folderRenames: number;
    folderMerges: number;
    noteMoves: number;
    error?: string;
}> {
    let folderRenames = 0;
    let folderMerges = 0;
    let noteMoves = 0;

    try {
        // Phase B(a): folder renames.
        for (const op of plan.operations) {
            if (op.kind !== 'rename') { continue; }
            const fromAbs = path.join(vaultRoot, op.from);
            const toAbs = path.join(vaultRoot, op.to);
            await fs.mkdir(path.dirname(toAbs), { recursive: true });
            await fs.rename(fromAbs, toAbs);
            folderRenames++;
        }

        // Phase B(b): folder merges.
        for (const op of plan.operations) {
            if (op.kind !== 'merge') { continue; }
            const fromAbs = path.join(vaultRoot, op.from);
            const intoAbs = path.join(vaultRoot, op.into);
            await fs.mkdir(intoAbs, { recursive: true });
            await moveDirectoryContents(fromAbs, intoAbs);
            // Remove source folder if it ends up empty.
            try { await fs.rmdir(fromAbs); } catch { /* not empty — leave it */ }
            folderMerges++;
        }

        // Phase B(c): note moves.
        for (const op of plan.operations) {
            if (op.kind !== 'move') { continue; }
            const fromAbs = path.join(vaultRoot, op.notePath);
            const basename = path.basename(op.notePath);
            const toAbs = path.join(vaultRoot, op.toFolder, basename);
            await fs.mkdir(path.dirname(toAbs), { recursive: true });
            await fs.rename(fromAbs, toAbs);
            noteMoves++;
        }
    } catch (err: any) {
        return { folderRenames, folderMerges, noteMoves, error: err.message ?? String(err) };
    }

    return { folderRenames, folderMerges, noteMoves };
}

async function moveDirectoryContents(srcDir: string, destDir: string): Promise<void> {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        await fs.rename(srcPath, destPath);
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: all 3 `buildPathMap` tests pass plus existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/restructureVault.ts src/test/restructureVault.test.ts
git commit -m "feat(restructure): add buildPathMap and applyPlan"
```

---

## Task 9: Wire it all together in the orchestrator

**Files:**
- Modify: `src/restructureVault.ts`

- [ ] **Step 1: Replace the stub `restructureVault` with the full orchestrator**

In `src/restructureVault.ts`, locate the stub at the bottom:

```ts
export async function restructureVault(rootDir: string): Promise<void> {
    vscode.window.showInformationMessage(`Restructure Vault: not yet implemented (root: ${rootDir})`);
}
```

Replace it with:

```ts
import { chatCompletionWithRetry } from './ai';
import { getAllFolders } from './files';
import { rewriteAllLinks } from './linkRewriter';

const OUTPUT_CHANNEL_NAME = 'AI Notes: Restructure';
let outputChannel: vscode.OutputChannel | undefined;

function log(message: string): void {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    }
    outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

export async function restructureVault(rootDir: string): Promise<void> {
    // 1. Strategy QuickPick.
    const strategy = await vscode.window.showQuickPick(
        [
            { label: 'Compact', description: 'Titles + tags only — fast' },
            { label: 'Detailed', description: 'Titles + tags + first 200 chars of body — slower, better quality' },
        ],
        { placeHolder: 'Choose context strategy' }
    );
    if (!strategy) { return; }
    const detailed = strategy.label === 'Detailed';

    // 2. Gather notes and folders.
    const notes = await gatherNotes(rootDir, detailed);
    if (notes.length === 0) {
        vscode.window.showInformationMessage('No notes found.');
        return;
    }
    if (notes.length === 1) {
        vscode.window.showInformationMessage('Need at least 2 notes to restructure.');
        return;
    }
    const folders = await getAllFolders(rootDir, 5);
    log(`Gathered ${notes.length} notes, ${folders.length} folders.`);

    // 3. Build prompt and call LLM.
    const prompt = buildPrompt(notes, folders);
    log(`Prompt size: ${prompt.length} chars (truncated): ${prompt.slice(0, 1000)}`);

    let response: string;
    try {
        response = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Restructure Vault: asking AI...' },
            () => chatCompletionWithRetry(prompt)
        );
    } catch (err: any) {
        vscode.window.showErrorMessage(`AI request failed: ${err.message}`);
        return;
    }

    // 4. Parse and validate.
    let plan: RestructurePlan;
    try {
        plan = parsePlan(response);
    } catch (err: any) {
        log(`Parse error: ${err.message}\nResponse: ${response}`);
        vscode.window.showErrorMessage(err.message);
        return;
    }
    log(`Parsed plan: ${JSON.stringify(plan)}`);

    if (plan.operations.length === 0) {
        vscode.window.showInformationMessage('Vault structure looks fine — no changes proposed.');
        return;
    }

    const state = buildVaultState(notes, folders);
    const validation = validatePlan(plan, state);
    if (!validation.ok) {
        log(`Validation failed: ${validation.error}`);
        vscode.window.showErrorMessage(`AI proposed an invalid plan: ${validation.error}`);
        return;
    }

    // 5. Show summary, ask for confirmation.
    const summary = summarizePlan(plan);
    const choice = await vscode.window.showInformationMessage(summary, { modal: true }, 'Apply', 'Cancel');
    if (choice !== 'Apply') { return; }

    // 6. Apply: build pathMap, do filesystem moves, then rewrite links.
    const pathMap = buildPathMap(plan, state, rootDir);
    log(`Built pathMap with ${pathMap.size} entries.`);

    const applyResult = await applyPlan(plan, rootDir);
    if (applyResult.error) {
        log(`Apply error after ${applyResult.folderRenames + applyResult.folderMerges + applyResult.noteMoves} ops: ${applyResult.error}`);
        vscode.window.showErrorMessage(
            `Restructure partially applied (${applyResult.folderRenames} renames, ${applyResult.folderMerges} merges, ${applyResult.noteMoves} moves) before error: ${applyResult.error}. Links not yet rewritten — please review the vault.`
        );
        return;
    }

    const rewriteResult = await rewriteAllLinks(rootDir, pathMap);
    log(`Link rewrite: ${rewriteResult.rewritten} notes updated, ${rewriteResult.failures.length} failures.`);
    for (const f of rewriteResult.failures) { log(`  failure: ${f.path} — ${f.error}`); }

    // 7. Final toast.
    const failurePart = rewriteResult.failures.length > 0
        ? `, ${rewriteResult.failures.length} link-rewrite failures (see Output panel)`
        : '';
    vscode.window.showInformationMessage(
        `Restructure done: ${applyResult.folderRenames} folder renames, ${applyResult.folderMerges} folder merges, ${applyResult.noteMoves} notes moved, ${rewriteResult.rewritten} notes had links rewritten${failurePart}.`
    );
}

function buildVaultState(notes: NoteEntry[], folders: string[]): VaultState {
    return {
        notes: new Set(notes.map(n => n.relPath)),
        folders: new Set(folders.map(f => f.split(path.sep).join('/'))),
    };
}

function summarizePlan(plan: RestructurePlan): string {
    let renames = 0, merges = 0, moves = 0;
    for (const op of plan.operations) {
        if (op.kind === 'rename') { renames++; }
        else if (op.kind === 'merge') { merges++; }
        else if (op.kind === 'move') { moves++; }
    }
    const lines = [
        'Proposed changes:',
        `• ${renames} folder rename${renames === 1 ? '' : 's'}`,
        `• ${merges} folder merge${merges === 1 ? '' : 's'}`,
        `• ${moves} note${moves === 1 ? '' : 's'} will move`,
    ];
    if (plan.rationale) {
        lines.push('', `Rationale: ${plan.rationale}`);
    }
    lines.push('', 'Apply this plan?');
    return lines.join('\n');
}
```

- [ ] **Step 2: Verify the build still passes**

Run: `npm run compile`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 3: Run all existing tests to confirm nothing regressed**

Run: `npm run test`
Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/restructureVault.ts
git commit -m "feat(restructure): wire orchestrator end-to-end"
```

---

## Task 10: End-to-end integration test with mocked AI

**Files:**
- Create: `src/test/restructureVaultIntegration.test.ts`

- [ ] **Step 1: Write the integration test**

This test exercises `applyPlan` + `rewriteAllLinks` against a temp-dir fixture vault. The orchestrator function `restructureVault` is not directly invoked because it depends on the VS Code UI surface (QuickPick, modal); the integration test focuses on the file-and-link mutation parts that have the highest risk of subtle bugs.

Create `src/test/restructureVaultIntegration.test.ts`:

```ts
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
    RestructurePlan,
    VaultState,
    buildPathMap,
    applyPlan,
} from '../restructureVault';
import { rewriteAllLinks } from '../linkRewriter';

suite('Restructure end-to-end on temp vault', () => {
    test('rename folder + move note + rewrite links', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aint-e2e-'));
        try {
            // Fixture:
            //   tmp/notes/host.md  — links to [[foo]] and [other](../archive/bar.md)
            //   tmp/notes/foo.md
            //   tmp/archive/bar.md
            await fs.mkdir(path.join(tmp, 'notes'), { recursive: true });
            await fs.mkdir(path.join(tmp, 'archive'), { recursive: true });
            await fs.writeFile(
                path.join(tmp, 'notes', 'host.md'),
                'See [[foo]] and [other](../archive/bar.md).'
            );
            await fs.writeFile(path.join(tmp, 'notes', 'foo.md'), 'Foo body.');
            await fs.writeFile(path.join(tmp, 'archive', 'bar.md'), 'Bar body.');

            const plan: RestructurePlan = {
                operations: [
                    { kind: 'rename', from: 'archive', to: 'old' },
                    { kind: 'move', notePath: 'notes/foo.md', toFolder: 'notes/inner' },
                ],
            };
            const state: VaultState = {
                notes: new Set(['notes/host.md', 'notes/foo.md', 'archive/bar.md']),
                folders: new Set(['notes', 'archive']),
            };

            const pathMap = buildPathMap(plan, state, tmp);
            const apply = await applyPlan(plan, tmp);
            assert.strictEqual(apply.error, undefined);
            assert.strictEqual(apply.folderRenames, 1);
            assert.strictEqual(apply.noteMoves, 1);

            // Filesystem assertions.
            await assertExists(path.join(tmp, 'old', 'bar.md'));
            await assertExists(path.join(tmp, 'notes', 'inner', 'foo.md'));
            await assertNotExists(path.join(tmp, 'archive'));
            await assertNotExists(path.join(tmp, 'notes', 'foo.md'));

            const rewrite = await rewriteAllLinks(tmp, pathMap);
            assert.strictEqual(rewrite.failures.length, 0);

            const newHost = await fs.readFile(path.join(tmp, 'notes', 'host.md'), 'utf8');
            // Wiki-link [[foo]] is preserved (basename unchanged).
            // Markdown link to bar.md must now point to the renamed folder.
            assert.match(newHost, /\[\[foo\]\]/);
            assert.match(newHost, /\[other\]\(\.\.\/old\/bar\.md\)/);
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
});

async function assertExists(p: string): Promise<void> {
    await fs.access(p);
}

async function assertNotExists(p: string): Promise<void> {
    let existed = false;
    try { await fs.access(p); existed = true; } catch { /* good */ }
    if (existed) { throw new Error(`Expected path not to exist: ${p}`); }
}
```

- [ ] **Step 2: Run the test**

Run: `npm run test`
Expected: integration test passes plus all earlier tests.

- [ ] **Step 3: Commit**

```bash
git add src/test/restructureVaultIntegration.test.ts
git commit -m "test(restructure): add end-to-end integration test on temp vault"
```

---

## Task 11: Manual smoke test

**Files:** none (manual verification only).

- [ ] **Step 1: Build a packaged extension**

Run: `npm run package`
Expected: build succeeds.

- [ ] **Step 2: Launch the extension host**

In VS Code, press F5 to launch the Extension Development Host. Open a folder containing a small markdown vault (or copy a few notes into a temp folder for this purpose). Make sure it has at least two folders and a few `.md` files with internal `[[wiki-links]]`.

- [ ] **Step 3: Run the command**

Open the Command Palette (Cmd+Shift+P / Ctrl+Shift+P). Run `AI Notes: Restructure Vault`. Pick **Compact**. Verify:

- The progress notification appears.
- The summary modal appears with operation counts and (if the LLM provides one) a rationale.
- Clicking **Cancel** leaves the vault unchanged.

- [ ] **Step 4: Run again and apply**

Run the command again, this time clicking **Apply**. Verify:

- File system is updated as the summary indicated.
- Internal links in surviving notes still resolve (Cmd+click a wiki-link should still work).
- Final toast reports counts.
- The `AI Notes: Restructure` Output channel contains a transcript.

- [ ] **Step 5: Commit any small adjustments needed**

If the smoke test reveals minor issues (typos in messages, formatting of the summary, etc.), fix them and commit:

```bash
git add -A
git commit -m "fix(restructure): smoke-test polish"
```

If no adjustments are needed, this task is complete with no commit.

---

## Self-Review

Coverage check against the spec:

- ✅ New command `AI Notes: Restructure Vault` — Tasks 1, 9
- ✅ Conservative AI-refined-from-existing strategy — Task 7 (`buildPrompt` includes the rules)
- ✅ Dry-run summary + single confirmation — Task 9 (`summarizePlan` + modal)
- ✅ Compact / Detailed runtime QuickPick — Task 9 + Task 6
- ✅ Three op kinds (rename, merge, move) — Task 2 (types), Task 8 (apply)
- ✅ Phase ordering (renames → merges → moves) — Task 8 (`applyPlan`)
- ✅ Path-map computed before mutation — Task 8 (`buildPathMap`)
- ✅ Link rewriting (wiki, markdown, image) — Tasks 3, 4
- ✅ Code-fence / inline-code skipping — Task 3
- ✅ Error policies (pre-LLM, LLM, validation, filesystem) — Task 9
- ✅ Output channel logging — Task 9
- ✅ Validation function extracted and unit-tested — Task 2
- ✅ Integration test on temp vault — Task 10
- ✅ Manual smoke test — Task 11

Type / signature consistency:

- `RestructurePlan`, `Operation`, `VaultState`, `NoteEntry`, `ValidationResult` — defined in Task 2 and 6, consistently used in Tasks 7, 8, 9, 10.
- `validatePlan(plan, state)`, `buildPathMap(plan, state, vaultRoot)`, `applyPlan(plan, vaultRoot)`, `rewriteAllLinks(vaultRoot, pathMap)`, `rewriteLinks(content, noteAbsPath, vaultRoot, pathMap)`, `gatherNotes(rootDir, detailed)`, `parsePlan(response)`, `buildPrompt(notes, folders)` — names and parameter orders consistent across tasks.

No placeholders or "TODO/TBD" markers. All steps include concrete code or commands.
