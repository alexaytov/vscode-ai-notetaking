# Change Log

All notable changes to the "ai-notes" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.10] - 2026-05-10

### Fixed

- **Restructure Vault: order-aware plan validation.** Previously, a plan with two ops where op 2 referenced a path that op 1 had moved (e.g., merge a parent folder, then merge its former child) would pass validation and fail mid-apply with `ENOENT`. The validator now simulates each op against a mutating state copy, so order-dependent failures are caught up front and the whole plan is rejected with a clear "does not exist" message.

## [0.0.9] - 2026-05-10

### Fixed

- **Restructure Vault: reject rename when target folder already exists.** Previously, if the AI proposed renaming `notes/foo bar` to `notes/foo-bar` and `notes/foo-bar` already existed with content, the OS rejected the operation with `ENOTEMPTY` mid-flight. The validator now catches this before any I/O and tells the user to re-run (the AI will then propose a `merge` instead).
- **Restructure Vault: clearer error when no operations were applied.** First-op failures now say "No operations applied before error: …" instead of the misleading "0 renames, 0 merges, 0 moves before error: …".

### Changed

- AI prompt now includes an explicit rule: "Use a 'merge' operation, NOT 'rename', when the target folder already exists."

## [0.0.8] - 2026-05-10

### Added

- **AI Notes: Restructure Vault** command — proposes and applies refinements to the entire vault's folder structure in one pass. Conservative AI-refined-from-existing strategy, dry-run summary with single confirmation, and automatic rewriting of internal `[[wiki-links]]`, markdown links, and image paths so nothing breaks when files move.
- New `linkRewriter` module with pure-function link rewriting that skips fenced code blocks and inline code.
- Compact / Detailed runtime context strategy chosen via QuickPick.
- Dedicated `AI Notes: Restructure` Output channel for transcripts of each restructure run.

### Fixed

- Cross-platform path handling in `buildPathMap` (Windows backslash / POSIX slash mixing).

## [Unreleased]