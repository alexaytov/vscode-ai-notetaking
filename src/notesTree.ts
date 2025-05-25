import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class NotesByTagProvider implements vscode.TreeDataProvider<NoteOrTagItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<NoteOrTagItem | undefined | void> = new vscode.EventEmitter<NoteOrTagItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<NoteOrTagItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private workspaceRoot: string) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: NoteOrTagItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: NoteOrTagItem): Promise<NoteOrTagItem[]> {
        if (!this.workspaceRoot) {
            return [];
        }
        if (!element) {
            // Top level: tags
            const notes = await findAllNotes(this.workspaceRoot);
            const tagMap: Record<string, string[]> = {};
            for (const note of notes) {
                const tags = await extractTags(note);
                for (const tag of tags) {
                    if (!tagMap[tag]) {tagMap[tag] = [];}
                    tagMap[tag].push(note);
                }
            }
            return Object.keys(tagMap).sort().map(tag => new NoteOrTagItem(tag, vscode.TreeItemCollapsibleState.Collapsed, tagMap[tag]));
        } else if (element.notePaths) {
            // Children: notes for a tag
            return element.notePaths.map(notePath => {
                const label = path.basename(notePath);
                const item = new NoteOrTagItem(label, vscode.TreeItemCollapsibleState.None);
                item.resourceUri = vscode.Uri.file(notePath);
                item.command = {
                    command: 'vscode.open',
                    title: 'Open Note',
                    arguments: [vscode.Uri.file(notePath)]
                };
                return item;
            });
        }
        return [];
    }
}

class NoteOrTagItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly notePaths?: string[]
    ) {
        super(label, collapsibleState);
    }
}

// Helper: find all .md files recursively
async function findAllNotes(root: string): Promise<string[]> {
    const result: string[] = [];
    async function walk(dir: string) {
        const files = await fs.promises.readdir(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = await fs.promises.stat(fullPath);
            if (stat.isDirectory()) {
                await walk(fullPath);
            } else if (file.endsWith('.md')) {
                result.push(fullPath);
            }
        }
    }
    await walk(root);
    return result;
}

// Helper: extract tags from YAML frontmatter
async function extractTags(filePath: string): Promise<string[]> {
    const content = await fs.promises.readFile(filePath, 'utf8');
    const match = content.match("tags:.*\\[(.*)\\]");
    if (match && match[1]) {
        const tags = match[1];
        return tags.split(', ').map(tag => tag.trim()).filter(tag => tag.length > 0);
    }
    return [];
}