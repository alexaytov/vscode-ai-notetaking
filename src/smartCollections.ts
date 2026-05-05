import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { extractTagsFromContent } from './tagCache';
import { searchNotes, gatherNotes } from './semanticSearch';

export interface Collection {
    name: string;
    tags: string[] | null;
    dateRange: number | null;
    query: string | null;
}

interface CollectionsFile {
    collections: Collection[];
}

export interface NoteForFilter {
    tags: string[];
    date: Date | null;
    filePath: string;
}

export function parseDateFromFilename(filename: string): Date | null {
    const match = filename.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (!match) { return null; }
    const [, dd, mm, yyyy] = match;
    const date = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    if (isNaN(date.getTime())) { return null; }
    return date;
}

export function matchesCollection(note: NoteForFilter, collection: Collection): boolean {
    if (collection.tags && collection.tags.length > 0) {
        const hasAll = collection.tags.every(t => note.tags.includes(t));
        if (!hasAll) { return false; }
    }

    if (collection.dateRange !== null && collection.dateRange > 0) {
        if (!note.date) { return false; }
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - collection.dateRange);
        if (note.date < cutoff) { return false; }
    }

    return true;
}

export async function loadCollections(workspaceRoot: string): Promise<Collection[]> {
    const filePath = path.join(workspaceRoot, '.ai-notes', 'collections.json');
    try {
        const content = await fsp.readFile(filePath, 'utf8');
        const data: CollectionsFile = JSON.parse(content);
        return data.collections || [];
    } catch {
        return [];
    }
}

export async function saveCollections(workspaceRoot: string, collections: Collection[]): Promise<void> {
    const dirPath = path.join(workspaceRoot, '.ai-notes');
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    const filePath = path.join(dirPath, 'collections.json');
    const data: CollectionsFile = { collections };
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function runCollection(
    collection: Collection,
    workspaceRoot: string
): Promise<string[]> {
    const allNotes = await gatherNotesForFilter(workspaceRoot);

    let filtered = allNotes.filter(note => matchesCollection(note, collection));

    if (collection.query && filtered.length > 0) {
        const noteInfos = await gatherNotes(workspaceRoot);
        const filteredPaths = new Set(filtered.map(n => n.filePath));
        const relevantNotes = noteInfos.filter(n => filteredPaths.has(n.filePath));
        return searchNotes(collection.query, relevantNotes);
    }

    return filtered.map(n => n.filePath);
}

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', '.claude', '_drafts']);

async function gatherNotesForFilter(workspaceRoot: string): Promise<NoteForFilter[]> {
    const notes: NoteForFilter[] = [];
    await walkForFilter(workspaceRoot, notes);
    return notes;
}

async function walkForFilter(dir: string, notes: NoteForFilter[]): Promise<void> {
    let entries;
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) { continue; }
            await walkForFilter(fullPath, notes);
        } else if (entry.name.endsWith('.md')) {
            try {
                const content = await fsp.readFile(fullPath, 'utf8');
                const tags = extractTagsFromContent(content);
                const date = parseDateFromFilename(entry.name);
                notes.push({ tags, date, filePath: fullPath });
            } catch {}
        }
    }
}
