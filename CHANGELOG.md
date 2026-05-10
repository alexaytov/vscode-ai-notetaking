# Change Log

All notable changes to the "ai-notes" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.8] - 2026-05-10

### Added

- **AI Notes: Restructure Vault** command — proposes and applies refinements to the entire vault's folder structure in one pass. Conservative AI-refined-from-existing strategy, dry-run summary with single confirmation, and automatic rewriting of internal `[[wiki-links]]`, markdown links, and image paths so nothing breaks when files move.
- New `linkRewriter` module with pure-function link rewriting that skips fenced code blocks and inline code.
- Compact / Detailed runtime context strategy chosen via QuickPick.
- Dedicated `AI Notes: Restructure` Output channel for transcripts of each restructure run.

### Fixed

- Cross-platform path handling in `buildPathMap` (Windows backslash / POSIX slash mixing).

## [Unreleased]