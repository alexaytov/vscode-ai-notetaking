import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { chatCompletionWithRetry } from './ai';
import { gatherNotes, NoteInfo } from './semanticSearch';

export interface NoteCluster {
    topic: string;
    description: string;
    noteIndices: number[];
}

export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

export function parseClusterResponse(response: string): NoteCluster[] {
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) { return []; }
    try {
        const arr = JSON.parse(match[0]);
        if (Array.isArray(arr) && arr.every(item =>
            typeof item.topic === 'string' &&
            typeof item.description === 'string' &&
            Array.isArray(item.noteIndices)
        )) {
            return arr;
        }
    } catch {}
    return [];
}

export async function generateMOC(workspaceRoot: string): Promise<string> {
    const notes = await gatherNotes(workspaceRoot);

    if (notes.length === 0) {
        throw new Error('No notes found in workspace.');
    }

    const noteList = notes.map((n, i) => {
        const name = path.basename(n.filePath);
        const desc = n.summary || n.snippet.slice(0, 60);
        return `${i + 1}. ${name} — ${desc}`;
    }).join('\n');

    const prompt = `Group these notes into 3-7 topic clusters based on their content and tags. Return ONLY a JSON array: [{ "topic": "Topic Name", "description": "One sentence description", "noteIndices": [1, 3, 5] }]

Notes:
${noteList}`;

    const response = await chatCompletionWithRetry(prompt);
    const clusters = parseClusterResponse(response);

    if (clusters.length === 0) {
        throw new Error('AI failed to generate topic clusters.');
    }

    // Create _moc/ directory
    const mocDir = path.join(workspaceRoot, '_moc');
    if (fs.existsSync(mocDir)) {
        const existing = await fsp.readdir(mocDir);
        for (const file of existing) {
            await fsp.unlink(path.join(mocDir, file));
        }
    } else {
        fs.mkdirSync(mocDir, { recursive: true });
    }

    // Generate topic files
    const indexEntries: string[] = [];

    for (const cluster of clusters) {
        const slug = slugify(cluster.topic);
        const noteLinks = cluster.noteIndices
            .filter(i => i >= 1 && i <= notes.length)
            .map(i => {
                const note = notes[i - 1];
                const relativePath = path.relative(mocDir, note.filePath);
                return `- [${path.basename(note.filePath)}](${relativePath})`;
            })
            .join('\n');

        const topicContent = `# ${cluster.topic}\n\n${cluster.description}\n\n## Notes\n\n${noteLinks}\n`;
        await fsp.writeFile(path.join(mocDir, `${slug}.md`), topicContent, 'utf8');

        indexEntries.push(`- [${cluster.topic}](${slug}.md) — ${cluster.description}`);
    }

    // Generate index
    const indexContent = `# Map of Content\n\n${indexEntries.join('\n')}\n`;
    const indexPath = path.join(mocDir, 'index.md');
    await fsp.writeFile(indexPath, indexContent, 'utf8');

    return indexPath;
}
