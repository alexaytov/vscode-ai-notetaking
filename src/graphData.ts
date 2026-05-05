import * as fsp from 'fs/promises';
import * as path from 'path';
import { extractTagsFromContent } from './tagCache';
import { extractMarkdownLinks } from './backlinksWebview';
import { extractSummaryFromContent } from './summaries';

export interface GraphNode {
    id: string;
    type: 'note' | 'tag';
    label: string;
    summary: string | null;
    connections: number;
}

export interface GraphEdge {
    source: string;
    target: string;
    type: 'tag' | 'link';
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export interface NoteGraphInput {
    filePath: string;
    tags: string[];
    links: string[];
    summary: string | null;
}

export function buildGraphData(notes: NoteGraphInput[]): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const tagNodeMap: Map<string, GraphNode> = new Map();
    const noteSet = new Set(notes.map(n => n.filePath));

    for (const note of notes) {
        const noteNode: GraphNode = {
            id: note.filePath,
            type: 'note',
            label: path.basename(note.filePath),
            summary: note.summary,
            connections: 0,
        };
        nodes.push(noteNode);

        for (const tag of note.tags) {
            const tagId = `tag:${tag}`;
            if (!tagNodeMap.has(tagId)) {
                const tagNode: GraphNode = {
                    id: tagId,
                    type: 'tag',
                    label: tag,
                    summary: null,
                    connections: 0,
                };
                tagNodeMap.set(tagId, tagNode);
                nodes.push(tagNode);
            }
            tagNodeMap.get(tagId)!.connections++;
            noteNode.connections++;
            edges.push({ source: note.filePath, target: tagId, type: 'tag' });
        }

        for (const linkTarget of note.links) {
            if (noteSet.has(linkTarget)) {
                noteNode.connections++;
                edges.push({ source: note.filePath, target: linkTarget, type: 'link' });
            }
        }
    }

    return { nodes, edges };
}

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', '.claude', '_drafts', '_site', '_moc']);

export async function scanWorkspaceForGraph(workspaceRoot: string): Promise<NoteGraphInput[]> {
    const notes: NoteGraphInput[] = [];
    await walkForGraph(workspaceRoot, workspaceRoot, notes);
    return notes;
}

async function walkForGraph(dir: string, workspaceRoot: string, notes: NoteGraphInput[]): Promise<void> {
    let entries;
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) { continue; }
            await walkForGraph(fullPath, workspaceRoot, notes);
        } else if (entry.name.endsWith('.md')) {
            try {
                const content = await fsp.readFile(fullPath, 'utf8');
                const tags = extractTagsFromContent(content);
                const markdownLinks = extractMarkdownLinks(content);
                const links = markdownLinks.map(l => path.resolve(path.dirname(fullPath), l.href));
                const summary = extractSummaryFromContent(content);
                notes.push({ filePath: fullPath, tags, links, summary });
            } catch {}
        }
    }
}
