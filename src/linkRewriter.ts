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
    const noteAbsPosix = norm(noteAbsPath);
    const segments = splitProseAndCode(content);
    const out = segments.map(seg => {
        if (seg.kind === 'code') { return seg.text; }
        let s = rewriteWikiLinksInProse(seg.text, basenameToNew);
        s = rewriteMarkdownLinksInProse(s, noteAbsPosix, normalizedMap);
        return s;
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
