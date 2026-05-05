# Approach A: Polish & Depth — Design Spec

## Overview

Five features that improve the day-to-day note-writing and organization experience in the AI Notes extension, building on the existing AI categorization pipeline, frontmatter system, and webview infrastructure.

## Features

### 1. Auto-classify on Save

**Goal:** Eliminate the need to manually invoke "AI Notes: Reclassify Note" after writing a draft.

**Behavior:**
- A persistent `workspace.onDidSaveTextDocument` listener watches files under `_drafts/`
- On save, if the file has non-empty content and no frontmatter tags, show a notification: "Classify this note?" with "Yes" and "Later" buttons
- "Yes" triggers the existing `promptUserForNoteMetadata` flow (AI suggests tags/folder/name, user confirms, file moves)
- "Later" dismisses — note stays in `_drafts/`
- Replace the current one-shot save listener in `newNote` with this persistent approach

**Files to modify:**
- `src/extension.ts` — replace one-shot listener with persistent `_drafts/` watcher

**Edge cases:**
- Empty files (initial creation) are skipped — only trigger when `content.trim().length > 0`
- Files that already have `tags:` in frontmatter are skipped
- If the user saves multiple times quickly, debounce with a 5-second window per file (only show one notification per file until dismissed or classified)
- Track which files have been dismissed with "Later" in memory — don't re-prompt until the file is closed and re-opened

---

### 2. Note Linking / Backlinks

**Goal:** Show which notes reference the currently open note using standard markdown relative links.

**Behavior:**
- New webview view `aiNotesBacklinksWebView` registered in the Explorer sidebar
- When a `.md` file is active, scans workspace for markdown links (`[text](relative-path.md)`) pointing to the current file
- Displays backlinks as a clickable list (filename + link text)
- Refreshes on `window.onDidChangeActiveTextEditor` and `workspace.onDidSaveTextDocument`

**Architecture:**
- Build an in-memory link index on extension activation by scanning all `.md` files
- Index structure: `Map<absolutePath, Array<{ from: string, linkText: string }>>`
- Update incrementally: on file save, re-parse only that file's links; on file delete, remove entries
- Use `workspace.createFileSystemWatcher('**/*.md')` for delete/create events

**Files to create:**
- `src/backlinksWebview.ts` — webview provider (similar pattern to `notesByTagWebview.ts`)

**Files to modify:**
- `package.json` — register new webview view
- `src/extension.ts` — register the provider

**Link detection regex:**
```
/\[([^\]]*)\]\(([^)]+\.md)\)/g
```
Resolve relative paths against the linking file's directory to get absolute paths for matching.

---

### 3. Tag Autocomplete

**Goal:** When editing tags in frontmatter, suggest existing tags from the workspace.

**Behavior:**
- Register a `CompletionItemProvider` for `markdown` language
- Trigger condition: cursor is inside a YAML frontmatter `tags: [...]` block
- Scan workspace for all existing tags (reuse walk logic from `getNotesByTag`)
- Cache the tag set in memory; invalidate on `workspace.onDidSaveTextDocument` for `.md` files
- Show tags as `CompletionItem` entries with frequency count in the detail field

**Detection logic for trigger:**
1. Check if document starts with `---`
2. Find the closing `---`
3. Check if cursor position is between them
4. Check if the current line matches `tags:` pattern

**Files to create:**
- `src/tagCompletionProvider.ts`

**Files to modify:**
- `src/extension.ts` — register the completion provider

---

### 4. Note Templates

**Goal:** Offer pre-filled templates when creating a new note.

**Behavior:**
- Ship 3 built-in templates in `resources/templates/`:
  - `meeting.md` — attendees, agenda, action items sections
  - `journal.md` — date header, highlights, reflections
  - `til.md` — topic, what I learned, references
- Users can add custom templates in `.templates/` at workspace root
- Modified `ai-notes.newNote` flow:
  1. Show QuickPick listing all templates + "Blank note" option
  2. Write selected template content into the new draft file
  3. Expand variables: `{{date}}` → current date, `{{title}}` → placeholder

**Template format:**
```markdown
# {{title}}

**Date:** {{date}}

## Section
Content here...
```

**Files to create:**
- `resources/templates/meeting.md`
- `resources/templates/journal.md`
- `resources/templates/til.md`
- `src/templates.ts` — template discovery and variable expansion

**Files to modify:**
- `src/extension.ts` — add QuickPick before file creation in `newNote`

---

### 5. Bulk Reclassify from Tag Webview

**Goal:** Select multiple notes in the tag browser and reclassify them in batch.

**Behavior:**
- Add checkboxes next to each note in the Notes by Tag webview
- Add a "Reclassify Selected" button in the filter bar (shown when >= 1 note is selected)
- Add "Select All" / "Deselect All" controls
- Processing flow on click:
  1. Show progress notification with "Processing note X of N..."
  2. For each note: run AI categorization, collect results
  3. Show a summary QuickPick for each note: confirm suggested tags/folder/name or skip
  4. User can "Accept All Remaining" to skip individual confirmations
  5. Apply changes (update frontmatter, rename, move)
  6. Refresh the webview

**Files to modify:**
- `src/notesByTagWebview.ts` — add checkboxes, selection state, new buttons, new message handlers
- `src/extension.ts` — handle the bulk reclassify message from webview (or keep logic in webview provider)

**UX details:**
- Checkbox state persists during filter changes within the same session
- Selection count badge shown on the "Reclassify Selected" button
- Progress is shown via VS Code's `window.withProgress` API

---

## Shared Infrastructure

All features reuse:
- `generateNoteMetadata()` from `src/ai.ts`
- `upsertFrontmatterKey()` from `src/frontmatter.ts`
- Filesystem walk pattern from `src/notesByTagWebview.ts` and `src/files.ts`
- VS Code webview patterns established in `notesByTagWebview.ts`

## Implementation Order

1. **Tag autocomplete** — smallest, standalone, immediately useful
2. **Note templates** — small, modifies `newNote` flow
3. **Auto-classify on save** — replaces existing listener logic
4. **Backlinks webview** — new component, medium effort
5. **Bulk reclassify** — most complex, touches existing webview

This order minimizes conflicts between concurrent changes and builds from simple to complex.
