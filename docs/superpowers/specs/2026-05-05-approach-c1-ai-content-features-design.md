# Approach C1: AI Content Features — Design Spec

## Overview

Three features that use AI to make notes queryable, organize them into topic maps, and synthesize multiple notes into single documents.

## Features

### 1. AI Chat Over Notes

**Goal:** Ask natural language questions about your notes and get answers with references to specific notes.

**UI:** Dedicated webview panel `aiNotesChatWebView` in the Explorer sidebar.

**Layout:**
- Scrollable message history (top)
- Text input + send button (bottom)
- "Clear" button to reset conversation history
- AI messages include clickable note filename references

**Behavior:**
- On each user message:
  1. Gather all workspace notes using `gatherNotes` (reuse from semantic search)
  2. Build context: note summaries/snippets + conversation history
  3. Send prompt to AI: "Answer the user's question based on these notes. Cite referenced notes by filename in square brackets like [filename.md]."
  4. Parse AI response for `[filename.md]` patterns, render as clickable links
  5. Append user message and AI response to conversation history
- Conversation history persists in memory (array of `{role: 'user' | 'assistant', content: string}`)
- "Clear" button resets the array and clears the chat display
- History resets on extension reload (not persisted to disk)

**Context window management:**
- Include all note summaries (or first 100 chars for unsummarized notes) as system context
- Include last 10 conversation turns to stay within context limits
- If workspace has > 50 notes, include only summaries (no snippets)

**Files:**
- Create: `src/chatWebview.ts` — webview provider with chat UI, message handling, conversation state
- Modify: `src/extension.ts` — register webview provider
- Modify: `package.json` — register webview view

---

### 2. Auto-generated MOC (Topic-based)

**Goal:** AI groups all workspace notes into topic clusters and generates linked index files.

**Command:** `ai-notes.generateMOC` ("AI Notes: Generate Map of Content")

**Flow:**
1. Gather all notes with tags and summaries using `gatherNotes`
2. Build prompt with note list (index, filename, summary, tags)
3. AI prompt: "Group these notes into 3-7 topic clusters based on their content and tags. Return ONLY a JSON array: `[{ "topic": "Topic Name", "description": "One sentence description", "noteIndices": [1, 3, 5] }]`"
4. Parse AI response as JSON
5. Create `_moc/` directory at workspace root (overwrite existing files)
6. For each cluster, generate `_moc/{topic-slug}.md`:
   ```markdown
   # {Topic Name}

   {Description}

   ## Notes

   - [note-filename.md](../relative/path/to/note.md)
   - [another-note.md](../relative/path/to/another.md)
   ```
7. Generate `_moc/index.md` linking to all topic files:
   ```markdown
   # Map of Content

   - [Topic Name](topic-slug.md) — Description
   - [Another Topic](another-topic.md) — Description
   ```
8. Open `_moc/index.md` in the editor
9. Show notification: "MOC generated with N topics"

**Regeneration:** Overwrites existing `_moc/` contents. This directory is auto-generated output, not hand-edited content.

**Slug generation:** Lowercase, replace spaces with dashes, remove special characters.

**Files:**
- Create: `src/mocGenerator.ts` — MOC generation logic (AI call, file creation, slug generation)
- Modify: `src/extension.ts` — register command
- Modify: `package.json` — register command

---

### 3. Note Merging

**Goal:** Select multiple notes on the same topic, AI synthesizes them into one comprehensive document.

**Entry points:**
- Tag browser: "Merge Selected" button (uses existing checkbox selection)
- Standalone command: `ai-notes.mergeNotes` ("AI Notes: Merge Notes") with multi-select QuickPick

**Flow:**
1. Collect selected note paths (from tag browser message or QuickPick selection)
2. Read full content of each selected note (strip frontmatter)
3. Check combined length: if > 8000 words, show warning and ask to continue or cancel
4. Send to AI with prompt: "Merge these notes into a single comprehensive document. Preserve all key information, remove redundancy, organize logically with clear headings. Output markdown only."
5. Create new file in `_drafts/merged_{date}_{uuid}.md` with AI output
6. Open the new file for review
7. Show notification: "Merged N notes into new draft"

**Important:** Original notes are NOT deleted or modified. The merged document is a new draft.

**Tag browser integration:** Add a "Merge Selected" button next to the existing "Reclassify Selected" button in `notesByTagWebview.ts`. Sends a `{ command: 'mergeNotes', paths: [...] }` message.

**Files:**
- Create: `src/noteMerger.ts` — merge logic (read notes, AI call, create output file)
- Modify: `src/notesByTagWebview.ts` — add "Merge Selected" button and message handler
- Modify: `src/extension.ts` — register command, handle merge from webview
- Modify: `package.json` — register command

---

## Shared Infrastructure

All features reuse:
- `chatCompletionWithRetry` from `src/ai.ts`
- `gatherNotes` from `src/semanticSearch.ts`
- `extractSummaryFromContent` from `src/summaries.ts`
- Webview patterns from existing providers
- `escapeHtml` utility (duplicated in each webview file — acceptable for isolation)

## Implementation Order

1. **Note Merging** — simplest (command + AI call + file write), exercises existing patterns
2. **MOC Generation** — medium (AI + multi-file generation), standalone command
3. **AI Chat** — most complex (new webview type with conversation state, different UI pattern)

This order builds from simple to complex, with the chat webview last since it introduces a new UI pattern (input + message list vs. the static display webviews used so far).
