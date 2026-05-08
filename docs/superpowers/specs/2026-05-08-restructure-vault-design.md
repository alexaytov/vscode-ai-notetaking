# Restructure Vault — Design Spec

## Overview

A new VS Code command, `AI Notes: Restructure Vault`, that proposes targeted improvements to the existing folder hierarchy of a notes vault and applies them after a single user confirmation. The action is conservative: it refines the current structure rather than redesigning it, and it never modifies note content beyond rewriting internal links to keep them valid after files move.

## Goals

- Clean up an organically-grown folder structure without manual triage.
- Operate on the **whole vault** in one shot, in contrast to the existing per-note classification (`autoClassify.ts`).
- Preserve correctness: internal `[[wiki-links]]`, markdown links, and image paths must still resolve after the run.
- Stay reversible-by-git: no content changes, no deletions — only file moves and folder renames.

## Non-Goals

- No content merging of duplicate or overlapping notes (deferred — separate feature).
- No deletion of notes or folders.
- No wholesale taxonomy redesign (the action only proposes refinements to the current structure).
- No undo command. Recovery is via the user's source control or backups.

## User-Facing Behavior

1. User runs `AI Notes: Restructure Vault` from the Command Palette.
2. Extension prompts a QuickPick: **Compact** (titles + tags only — fast) or **Detailed** (titles + tags + first 200 chars of each note's body, taken after the frontmatter block — slower, better quality).
3. Extension calls the LLM and receives a `RestructurePlan`.
4. Extension shows a single dry-run summary of the form:

   > Proposed changes:
   > • 3 folder renames
   > • 1 folder merge
   > • 12 notes will move
   >
   > Rationale: <one paragraph from the LLM>
   >
   > [Apply] [Cancel]

5. On **Apply**: extension performs renames, then moves, then rewrites all affected links. Shows a final toast summarizing what changed.
6. On **Cancel**: silent exit. Vault is untouched.

## Architecture

### Modules

- `src/restructureVault.ts` — orchestrates the workflow. Single exported function `restructureVault(rootDir: string): Promise<void>`. Uses existing `chatCompletionWithRetry` from `ai.ts` and `getAllFolders` from `files.ts`.
- `src/linkRewriter.ts` — pure functions for rewriting internal links when files move. No `vscode` import, no `fs` in the core function. Two exports:
  - `rewriteLinks(content, noteAbsPath, vaultRoot, pathMap): string` — pure
  - `rewriteAllLinks(vaultRoot, pathMap): Promise<number>` — convenience wrapper that walks the vault and writes back changed notes
- `src/extension.ts` — adds one new `vscode.commands.registerCommand('ai-notes.restructureVault', ...)` that delegates to `restructureVault`.
- `package.json` — adds the `ai-notes.restructureVault` command contribution.

### No Changes To

- `ai.ts`, `ai-core.ts` (existing AI invocation reused as-is).
- `frontmatter.ts`, `files.ts`, `tagCache.ts` (read-only consumers).
- `autoClassify.ts` (per-note classification is unrelated to vault-wide restructure).

### Module Layout Rationale

The codebase already follows a one-feature-per-module pattern (`siteExporter.ts`, `noteMerger.ts`, `mocGenerator.ts`). The new command adopts the same pattern. `extension.ts` (already 670 lines) gains only a thin command registration; the workflow lives in `restructureVault.ts`.

`linkRewriter.ts` is split out separately because (a) it has the only non-trivial logic worth unit-testing carefully, and (b) keeping it pure (string in, string out) lets us test markdown edge cases without the VS Code test harness.

## Data Types

```ts
type FolderRename = { kind: 'rename'; from: string; to: string };
// Merge: move every note from `from` into `into`, then remove `from` if empty.
// Effectively a folder-wide bulk move; the orchestrator decomposes it into note moves
// during pathMap construction.
type FolderMerge  = { kind: 'merge';  from: string; into: string };
type NoteMove     = { kind: 'move';   notePath: string; toFolder: string };

type RestructurePlan = {
  operations: (FolderRename | FolderMerge | NoteMove)[];
  rationale?: string;
};

type NoteEntry = {
  relPath: string;     // path relative to vaultRoot, e.g. "ai/notes/foo.md"
  title: string;       // basename without extension, or H1 if available
  tags: string[];      // from frontmatter
  preview?: string;    // first ~200 chars of body, only set in Detailed mode
};
```

All paths in `RestructurePlan` operations are **relative to `vaultRoot`** and use forward slashes regardless of OS. Operations are applied in declared order.

## Data Flow

1. **Command invocation** — `extension.ts` resolves `vaultRoot` from the workspace folder. If no workspace folder is open, error and exit.
2. **`gatherNotes(vaultRoot)`** — walks all `.md` files recursively, parses YAML frontmatter for `tags`, derives `title` from the filename (basename without extension). Returns `NoteEntry[]`.
3. **Strategy QuickPick** — user picks Compact or Detailed. If Detailed, read first 200 chars of each note's body (after the frontmatter block) and populate `preview`.
4. **`buildPrompt(notes, currentFolderTree, strategy)`** — composes the prompt. Asks the LLM for a JSON `RestructurePlan` and explicitly instructs:
   - Be conservative — propose only changes that materially improve organization.
   - Do not invent folders for fewer than 2 notes.
   - Do not propose moves where the note is already in a sensible folder.
   - Output only valid JSON matching the `RestructurePlan` schema.
5. **`chatCompletionWithRetry(prompt)`** — reuses the existing AI invocation (3 retries on transport failure).
6. **`parsePlan(response)`** — `JSON.parse` with try/catch; on failure attempts a regex extraction (matching the pattern in `ai.ts`). Returns a `RestructurePlan` or throws.
7. **`validatePlan(plan, vaultState)`** — pure function. Checks: every `from`/`notePath` exists in `vaultState`; no two operations produce the same destination; no folder operation creates a cycle (move A into A/sub); operations array is internally consistent. Throws on any violation. Empty operations array is valid (treated as no-op).
8. **`summarizePlan(plan)`** — composes the dry-run string with counts per op-kind plus the LLM's rationale.
9. **`showInformationMessage(summary, 'Apply', 'Cancel')`** — single confirmation. Cancel = exit, no mutations. Apply = continue.
10. **`applyPlan(plan, vaultRoot)`** — three phases:
    - **Phase A: build `pathMap`.** Pure computation. For each operation, derive the absolute `oldPath` → `newPath` mapping for every note affected. Map is held in memory across phases.
    - **Phase B: filesystem mutations.** In order: folder renames, then folder merges (mkdir destination, move contents, rmdir source if empty), then note moves. Sequential, not parallel. On any error, stop immediately and report partial state.
    - **Phase C: link rewriting.** `rewriteAllLinks(vaultRoot, pathMap)` walks the vault and rewrites links in every note. Per-note errors are logged but do not stop the sweep.
11. **Final toast** — `"Restructured: X notes moved, Y folders renamed, Z links rewritten."` (with failure count if any.)

### Phase Ordering Invariant

Folder renames must happen **before** note moves. If the LLM proposes "rename folder A → A-renamed AND move note.md from A → B", performing the rename first ensures the note's source path is still valid when the move runs. The orchestrator enforces this regardless of the order in `plan.operations`.

## Link Rewriting

`linkRewriter.ts` handles three forms:

1. **Wiki-links** — `[[name]]` and `[[name|alias]]`. Resolved by basename match against the vault. If `name.md` is in `pathMap`, rewrite the link target to the new basename (basenames are usually preserved across moves, but the resolution itself confirms the link still has a target).
2. **Markdown links** — `[text](relative/path.md)` and `[text](relative/path.md#anchor)`. Resolved by computing the absolute target path from the note's old absolute path + the relative reference, looking up the absolute path in `pathMap`, and re-emitting a relative path from the note's new location to the target's new location. Anchors and link text are preserved verbatim.
3. **Image links** — `![alt](relative/image.png)`. Same mechanism as markdown links. Images are not normally in `pathMap` (we don't move them), so most image links are no-ops; the case is handled for correctness when a note moves to a different depth and needs its relative image path adjusted.

### Out of Scope for Rewriting

- Absolute URLs (`http://...`, `https://...`) — left untouched.
- Code-fenced regions (between triple backticks) and inline-code spans (single backticks) — content inside is skipped so we do not rewrite something like `` `[[example]]` `` that appears as a literal code sample.
- Pre-existing broken links (e.g., `[[ghost]]` where `ghost.md` does not exist) — left untouched. We do not attempt to "fix" links that were already broken.

## Error Handling

### Pre-LLM (steps 1–3)

| Condition | Response |
|---|---|
| No workspace folder open | `showErrorMessage`, exit |
| 0 notes in vault | `showInformationMessage`, exit |
| 1 note in vault | `showInformationMessage("Need at least 2 notes")`, exit |
| Frontmatter parse failure on a single note | Log, treat note as having no tags, continue |
| User dismisses QuickPick | Silent exit |

### LLM (step 5)

`chatCompletionWithRetry` retries 3× on transport errors. If all retries fail, `showErrorMessage` and exit. No mutations occurred.

### Plan Validation (steps 6–7)

| Failure | Message |
|---|---|
| Response not valid JSON | "AI response was not in the expected format." |
| Operation references missing folder | "AI proposed renaming '<path>' which does not exist." |
| Operation references missing note | "AI proposed moving '<path>' which does not exist." |
| Two ops produce same destination | "AI proposed conflicting moves to '<path>'." |
| Folder operation creates a cycle | "AI proposed an invalid folder operation." |
| Empty operations array | `showInformationMessage("Vault structure looks fine — no changes proposed.")`, exit cleanly |

All validation failures exit before any disk writes.

### Filesystem (step 10)

**Phase B** — On the first move/rename failure, stop immediately. **Do not start Phase C.** Report:

> Restructure partially applied: N of M operations completed before error: <message>. Some notes have moved but links are not yet rewritten — please review the vault.

No rollback attempt. The user has source control; rollback for filesystem ops is its own can of worms and is more error-prone than honest reporting.

**Phase C** — Per-note try/catch. A failure on note X does not block notes Y and Z. Final toast reports the count of failed link rewrites; details are logged to the `AI Notes: Restructure` Output channel.

### Logging

A dedicated VS Code Output channel `AI Notes: Restructure` receives:

- The prompt sent to the LLM (truncated to 1000 chars)
- The parsed plan
- Validation outcomes
- Every move and rename attempted, with success/failure
- Every link rewrite attempted, with success/failure

The channel is opt-in (the user opens it explicitly) and does not clutter the UI.

## Testing

### Unit tests for `linkRewriter.ts`

Pure-function table tests, no VS Code harness needed. Cases:

| # | Case |
|---|---|
| 1 | Wiki-link basename match — rewritten if pathMap covers it |
| 2 | Wiki-link with alias — alias preserved, target updated |
| 3 | Wiki-link to unmoved note — unchanged |
| 4 | Markdown link relative — recomputed relative to old note location |
| 5 | Markdown link with anchor — anchor preserved |
| 6 | Markdown link to image not in pathMap — unchanged |
| 7 | Code-fenced link — unchanged |
| 8 | Inline-code link — unchanged |
| 9 | Self-reference (note contains its own old path) — rewritten correctly |
| 10 | Multiple links in one note — each handled independently |
| 11 | Empty pathMap — content returned unchanged (fast path) |
| 12 | Pre-existing broken link — unchanged |

### Unit tests for `validatePlan`

Extracted as an internal pure function so it can be tested directly:

| Case | Expected |
|---|---|
| Plan with rename to existing destination | rejected |
| Plan that moves folder A into A/sub | rejected |
| Plan referencing non-existent folder | rejected |
| Plan referencing non-existent note | rejected |
| Plan with empty operations array | accepted |
| Plan with valid mix of all op types | accepted |

### Integration test

One end-to-end test against a fixture vault in a temp directory:

- 6–8 markdown files across 3 folders, with internal wiki-links and markdown links between them
- Mock `chatCompletionWithRetry` to return a hand-crafted plan exercising all three op types
- Stub QuickPick and `showInformationMessage` to auto-select Compact / Apply
- Assertions: files are at expected new paths, links resolve correctly after the run, original folders are removed if empty

### Out of Scope for Testing

- LLM output quality. That is a prompt-tuning concern; we test the parser/validator with hand-crafted good-and-bad plans, which gives equivalent code coverage.
- VS Code UI surface (QuickPick, toasts) — stubbed at the integration boundary, not separately tested.
- Exhaustive filesystem error paths — we trust `fs.rename` and `fs.mkdir`; we test that *our* error handlers fire when they throw, not every OS error.

## Open Questions

None at design time. The strategy choice (Compact vs Detailed) is a runtime decision, not a design-time question.

## File Summary

**New files:**
- `src/restructureVault.ts` (~250 lines)
- `src/linkRewriter.ts` (~120 lines)
- `src/test/linkRewriter.test.ts` (~150 lines)
- `src/test/restructureVault.test.ts` (~80 lines for `validatePlan` + integration)

**Modified files:**
- `src/extension.ts` — add command registration (~10 lines)
- `package.json` — add command contribution (~4 lines)
