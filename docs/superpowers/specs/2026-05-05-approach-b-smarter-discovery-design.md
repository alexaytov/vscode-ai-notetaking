# Approach B: Smarter Discovery — Design Spec

## Overview

Four features that make existing notes more useful and discoverable through AI-powered summaries, similarity matching, semantic search, and saved collection queries.

## Features

### 1. AI Note Summaries

**Goal:** Add a one-line AI-generated summary to each note's frontmatter, displayed in the tag browser.

**Command:** `ai-notes.generateSummary` ("AI Notes: Generate Summary")

**Behavior:**
- Invoked on the active `.md` file
- Strips YAML frontmatter from content before sending to AI
- AI prompt: "Summarize this note in one concise sentence (max 15 words). Output only the summary, no quotes or extra formatting."
- Stores result in frontmatter as `summary: "the summary text here"` using `upsertFrontmatterKey`
- Shows info notification: "Summary generated: ..."

**Tag browser integration:**
- Modify `notesByTagWebview.ts` to extract and display the `summary` field below each note filename
- Truncate display to ~80 characters with ellipsis
- Style: smaller font, muted color, below the note name

**Files:**
- Create: `src/summaries.ts` — `generateSummary(content: string): Promise<string>`
- Modify: `src/extension.ts` — register command
- Modify: `src/notesByTagWebview.ts` — display summaries in the note list
- Modify: `package.json` — register command

---

### 2. Related Notes (Hybrid: Tag Overlap + AI Ranking)

**Goal:** Show notes related to the currently open note in a sidebar panel.

**Webview:** `aiNotesRelatedWebView` in Explorer sidebar

**Two-stage algorithm:**

**Stage 1 — Tag overlap (fast, no AI):**
- Get current note's tags from frontmatter
- Find all other notes sharing >= 1 tag
- Score each by number of shared tags (higher = more related)
- Take top 10 candidates

**Stage 2 — AI refinement (optional, uses API call):**
- If the current note has a summary and candidates have summaries:
  - Send current note summary + candidate summaries to AI
  - Ask AI to rank them by relevance (return ordered list of indices)
  - Display top 5 from AI-ranked list
- If summaries are not available: skip AI, show tag-overlap top 5 directly

**AI prompt for ranking:**
```
Given this note summary: "[current note summary]"

Rank these candidate notes by relevance (most related first). Return only the numbers as a comma-separated list.

1. "[candidate 1 summary]"
2. "[candidate 2 summary]"
...
```

**UI:** Same pattern as backlinks webview — clickable list of filenames with summaries shown below each.

**Refresh:** On `window.onDidChangeActiveTextEditor`. Debounce 500ms to avoid rapid AI calls when switching tabs.

**Files:**
- Create: `src/relatedNotesWebview.ts` — webview provider with two-stage algorithm
- Modify: `src/extension.ts` — register webview provider
- Modify: `package.json` — register webview view

---

### 3. Semantic Search (QuickPick)

**Goal:** Find notes by meaning using natural language queries.

**Command:** `ai-notes.semanticSearch` ("AI Notes: Search Notes")

**Flow:**
1. Show InputBox: "What are you looking for?"
2. Gather all workspace notes: for each, use its summary (from frontmatter) if available, otherwise first 100 characters of content (stripped of frontmatter)
3. Send query + note summaries to AI in a single prompt
4. AI returns a JSON array of matched note paths ranked by relevance
5. Show results in QuickPick — selecting one opens the file

**AI prompt:**
```
You are a note search assistant. Given the search query and a list of notes with their summaries, return the indices of the most relevant notes (up to 10), ranked by relevance.

Query: "[user query]"

Notes:
1. [path] — [summary or first 100 chars]
2. [path] — [summary or first 100 chars]
...

Respond with a JSON array of indices: [3, 7, 1, ...]
```

**Context window management:**
- If workspace has > 50 notes, batch into groups of 50 and run multiple AI calls
- Merge results by taking top 10 across all batches
- Each note entry in the prompt is limited to: filename + summary (or 100 chars)

**Files:**
- Create: `src/semanticSearch.ts` — search logic (gather notes, prompt AI, parse results)
- Modify: `src/extension.ts` — register command
- Modify: `package.json` — register command

---

### 4. Smart Collections (Saved Searches)

**Goal:** Save and re-run frequently used note queries.

**Command:** `ai-notes.smartCollections` ("AI Notes: Smart Collections")

**Storage:** `.ai-notes/collections.json` at workspace root

**Collection schema:**
```json
{
  "collections": [
    {
      "name": "Recent meetings",
      "tags": ["meeting"],
      "dateRange": 14,
      "query": null
    },
    {
      "name": "Notes about auth",
      "tags": null,
      "dateRange": null,
      "query": "authentication and authorization"
    }
  ]
}
```

**Filter logic:**
- `tags` (optional): note must have ALL specified tags (AND logic)
- `dateRange` (optional): note filename date must be within last N days
- `query` (optional): after tag/date filtering, run semantic search on remaining notes to further rank

**Date parsing:** Extract date from filename pattern `DD-MM-YYYY` (matches existing naming convention).

**Flow:**
1. Show QuickPick with saved collections + "New Collection..." + "Delete Collection..."
2. If existing collection selected: run filter, show matching notes in QuickPick
3. If "New Collection...": prompt for name, then tags (comma-separated, optional), then date range (days, optional), then query (optional). Save to collections.json.
4. If "Delete Collection...": show list, select to remove

**Files:**
- Create: `src/smartCollections.ts` — collection CRUD, filter/run logic
- Create: `.ai-notes/` directory management (create on first use)
- Modify: `src/extension.ts` — register command
- Modify: `package.json` — register command

---

## Shared Infrastructure

All features reuse:
- `chatCompletionWithRetry` from `src/ai.ts` for AI calls
- `extractTagsFromContent` from `src/tagCache.ts` for reading tags
- `upsertFrontmatterKey` from `src/frontmatter.ts` for writing summaries
- `TagCache` from `src/tagCache.ts` for tag-overlap queries in related notes
- Webview patterns from existing `notesByTagWebview.ts` and `backlinksWebview.ts`

## Implementation Order

1. **AI Summaries** — standalone command + tag browser integration (foundation for features 2-3)
2. **Semantic Search** — uses summaries for better results
3. **Related Notes** — depends on summaries + tag cache
4. **Smart Collections** — combines tag filtering + semantic search

This order ensures each feature has its dependencies available.
