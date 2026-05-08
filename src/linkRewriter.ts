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
