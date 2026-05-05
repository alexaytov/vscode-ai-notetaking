import * as fsp from 'fs/promises';
import * as path from 'path';
import { chatCompletionWithRetry } from './ai';
import { extractSummaryFromContent } from './summaries';

export interface NoteInfo {
    filePath: string;
    summary: string | null;
    snippet: string;
}

export function parseSearchResults(response: string): number[] {
    const match = response.match(/\[[\d,\s]+\]/);
    if (!match) { return []; }
    try {
        const arr = JSON.parse(match[0]);
        if (Array.isArray(arr) && arr.every(n => typeof n === 'number')) {
            return arr;
        }
    } catch {}
    return [];
}

export function buildNoteEntry(filePath: string, summary: string | null, content?: string): string {
    const name = path.basename(filePath);
    if (summary) {
        return `${name} — ${summary}`;
    }
    const snippet = (content || '').slice(0, 100);
    return `${name} — ${snippet}`;
}

export async function gatherNotes(workspaceRoot: string): Promise<NoteInfo[]> {
    const notes: NoteInfo[] = [];
    await walk(workspaceRoot, notes);
    return notes;
}

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', '.claude', '_drafts']);

async function walk(dir: string, notes: NoteInfo[]): Promise<void> {
    let entries;
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) { continue; }
            await walk(fullPath, notes);
        } else if (entry.name.endsWith('.md')) {
            try {
                const content = await fsp.readFile(fullPath, 'utf8');
                const yamlRegex = /^---\n(?:.*\n)*?---\n/;
                const cleanedContent = content.replace(yamlRegex, '');
                const summary = extractSummaryFromContent(content);
                notes.push({
                    filePath: fullPath,
                    summary,
                    snippet: cleanedContent.slice(0, 100),
                });
            } catch {}
        }
    }
}

export async function searchNotes(query: string, notes: NoteInfo[]): Promise<string[]> {
    const BATCH_SIZE = 50;
    const allIndices: Array<{ index: number; batchOffset: number }> = [];

    for (let i = 0; i < notes.length; i += BATCH_SIZE) {
        const batch = notes.slice(i, i + BATCH_SIZE);
        const noteList = batch.map((n, idx) => {
            const display = buildNoteEntry(n.filePath, n.summary, n.snippet);
            return `${idx + 1}. ${display}`;
        }).join('\n');

        const prompt = `You are a note search assistant. Given the search query and a list of notes with their summaries, return the indices of the most relevant notes (up to 10), ranked by relevance.

Query: "${query}"

Notes:
${noteList}

Respond with ONLY a JSON array of indices, e.g. [3, 7, 1]. No other text.`;

        try {
            const response = await chatCompletionWithRetry(prompt);
            const indices = parseSearchResults(response);
            for (const idx of indices) {
                if (idx >= 1 && idx <= batch.length) {
                    allIndices.push({ index: idx - 1 + i, batchOffset: allIndices.length });
                }
            }
        } catch {}
    }

    return allIndices.slice(0, 10).map(item => notes[item.index].filePath);
}
