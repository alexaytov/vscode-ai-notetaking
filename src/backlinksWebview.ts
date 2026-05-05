import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';

export interface MarkdownLink {
    text: string;
    href: string;
}

export function extractMarkdownLinks(content: string): MarkdownLink[] {
    const regex = /\[([^\]]*)\]\(([^)]+\.md)\)/g;
    const links: MarkdownLink[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        const href = match[2];
        if (/^https?:\/\//.test(href)) { continue; }
        links.push({ text: match[1], href });
    }
    return links;
}

interface BacklinkEntry {
    fromFile: string;
    linkText: string;
}

export class BacklinksWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiNotesBacklinksWebView';
    private view?: vscode.WebviewView;
    private linkIndex: Map<string, BacklinkEntry[]> = new Map();
    private disposables: vscode.Disposable[] = [];

    constructor(private workspaceRoot: string) {}

    async initialize(): Promise<void> {
        await this.buildIndex();

        const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
        watcher.onDidChange(() => this.rebuildIndex());
        watcher.onDidCreate(() => this.rebuildIndex());
        watcher.onDidDelete(() => this.rebuildIndex());
        this.disposables.push(watcher);

        vscode.window.onDidChangeActiveTextEditor(() => this.refresh(), null, this.disposables);
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };

        webviewView.webview.onDidReceiveMessage(message => {
            if (message.command === 'openNote') {
                const uri = vscode.Uri.file(message.path);
                vscode.window.showTextDocument(uri);
            }
        });

        this.refresh();
    }

    private refresh(): void {
        if (!this.view) { return; }
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.md')) {
            this.view.webview.html = this.getHtml([]);
            return;
        }

        const currentFile = editor.document.uri.fsPath;
        const backlinks = this.linkIndex.get(currentFile) || [];
        this.view.webview.html = this.getHtml(backlinks);
    }

    private async buildIndex(): Promise<void> {
        this.linkIndex.clear();
        await this.walkAndIndex(this.workspaceRoot);
    }

    private async rebuildIndex(): Promise<void> {
        await this.buildIndex();
        this.refresh();
    }

    private async walkAndIndex(dir: string): Promise<void> {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch { return; }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (BacklinksWebviewProvider.EXCLUDED_DIRS.has(entry.name)) { continue; }
                await this.walkAndIndex(fullPath);
            } else if (entry.name.endsWith('.md')) {
                try {
                    const content = await fsp.readFile(fullPath, 'utf8');
                    const links = extractMarkdownLinks(content);
                    for (const link of links) {
                        const targetPath = path.resolve(path.dirname(fullPath), link.href);
                        const existing = this.linkIndex.get(targetPath) || [];
                        existing.push({ fromFile: fullPath, linkText: link.text });
                        this.linkIndex.set(targetPath, existing);
                    }
                } catch {}
            }
        }
    }

    private static readonly EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', '.claude']);

    private getHtml(backlinks: BacklinkEntry[]): string {
        if (backlinks.length === 0) {
            return `<body style="font-family: var(--vscode-font-family); color: var(--vscode-sideBar-foreground); padding: 12px;">
                <i>No backlinks found.</i>
            </body>`;
        }
        const items = backlinks.map(b => {
            const name = path.basename(b.fromFile);
            return `<div class="backlink" data-path="${b.fromFile}" style="cursor:pointer; padding:4px 8px; border-radius:3px; margin:2px 0;">
                <span style="color:var(--vscode-textLink-foreground);">${name}</span>
                <span style="opacity:0.7; font-size:0.9em;"> — "${b.linkText}"</span>
            </div>`;
        }).join('');

        return `<body style="font-family: var(--vscode-font-family); color: var(--vscode-sideBar-foreground); padding: 12px;">
            <div style="font-weight:bold; margin-bottom:8px;">Backlinks (${backlinks.length})</div>
            ${items}
            <script>
                const vscode = acquireVsCodeApi();
                document.querySelectorAll('.backlink').forEach(el => {
                    el.addEventListener('click', () => {
                        vscode.postMessage({ command: 'openNote', path: el.getAttribute('data-path') });
                    });
                    el.addEventListener('mouseenter', () => { el.style.background = 'var(--vscode-list-hoverBackground)'; });
                    el.addEventListener('mouseleave', () => { el.style.background = ''; });
                });
            </script>
        </body>`;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
