import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';

export function extractTagsFromContent(content: string): string[] {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) { return []; }
    const yaml = match[1];
    const tagsLine = yaml.split('\n').find(line => line.trim().startsWith('tags:'));
    if (!tagsLine) { return []; }
    const tagsMatch = tagsLine.match(/\[(.*?)\]/);
    if (!tagsMatch) { return []; }
    return tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
}

export class TagCache {
    private tags: Map<string, number> = new Map();
    private initialized = false;
    private disposables: vscode.Disposable[] = [];

    constructor(private workspaceRoot: string) {}

    async initialize(): Promise<void> {
        if (this.initialized) { return; }
        await this.fullScan();
        this.initialized = true;

        const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
        watcher.onDidChange(uri => this.rescanFile(uri.fsPath));
        watcher.onDidCreate(uri => this.rescanFile(uri.fsPath));
        watcher.onDidDelete(uri => this.removeFile(uri.fsPath));
        this.disposables.push(watcher);
    }

    getTagsWithFrequency(): Array<{ tag: string; count: number }> {
        return Array.from(this.tags.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);
    }

    getAllTags(): string[] {
        return Array.from(this.tags.keys()).sort();
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }

    private async fullScan(): Promise<void> {
        this.tags.clear();
        await this.walk(this.workspaceRoot);
    }

    private static readonly EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', '.claude']);

    private async walk(dir: string): Promise<void> {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch { return; }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (TagCache.EXCLUDED_DIRS.has(entry.name)) { continue; }
                await this.walk(fullPath);
            } else if (entry.name.endsWith('.md')) {
                await this.indexFile(fullPath);
            }
        }
    }

    private async indexFile(filePath: string): Promise<void> {
        try {
            const content = await fsp.readFile(filePath, 'utf8');
            const tags = extractTagsFromContent(content);
            for (const tag of tags) {
                this.tags.set(tag, (this.tags.get(tag) || 0) + 1);
            }
        } catch {}
    }

    private async rescanFile(filePath: string): Promise<void> {
        if (!filePath.endsWith('.md')) { return; }
        await this.fullScan();
    }

    private async removeFile(_filePath: string): Promise<void> {
        await this.fullScan();
    }
}
