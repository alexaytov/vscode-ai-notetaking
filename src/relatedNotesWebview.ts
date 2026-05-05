import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { extractTagsFromContent, TagCache } from './tagCache';
import { extractSummaryFromContent } from './summaries';
import { chatCompletionWithRetry } from './ai';

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

interface RelatedNote {
    filePath: string;
    summary: string | null;
    score: number;
}

export class RelatedNotesWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiNotesRelatedWebView';
    private view?: vscode.WebviewView;
    private disposables: vscode.Disposable[] = [];
    private debounceTimer?: NodeJS.Timeout;

    constructor(
        private workspaceRoot: string,
        private tagCache: TagCache
    ) {}

    initialize(): void {
        vscode.window.onDidChangeActiveTextEditor(() => {
            if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
            this.debounceTimer = setTimeout(() => this.refresh(), 500);
        }, null, this.disposables);
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

    private async refresh(): Promise<void> {
        if (!this.view) { return; }
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.md')) {
            this.view.webview.html = this.getHtml([]);
            return;
        }

        const currentFile = editor.document.uri.fsPath;
        const content = editor.document.getText();
        const currentTags = extractTagsFromContent(content);
        const currentSummary = extractSummaryFromContent(content);

        if (currentTags.length === 0) {
            this.view.webview.html = this.getHtml([]);
            return;
        }

        const candidates = await this.findByTagOverlap(currentFile, currentTags);

        let ranked: RelatedNote[];
        if (currentSummary && candidates.some(c => c.summary !== null)) {
            ranked = await this.aiRank(currentSummary, candidates);
        } else {
            ranked = candidates.slice(0, 5);
        }

        this.view.webview.html = this.getHtml(ranked);
    }

    private async findByTagOverlap(currentFile: string, currentTags: string[]): Promise<RelatedNote[]> {
        const candidates: Map<string, RelatedNote> = new Map();
        await this.walkForCandidates(this.workspaceRoot, currentFile, currentTags, candidates);

        return Array.from(candidates.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
    }

    private static readonly EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.vscode', '.claude', '_drafts']);

    private async walkForCandidates(
        dir: string,
        currentFile: string,
        currentTags: string[],
        candidates: Map<string, RelatedNote>
    ): Promise<void> {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch { return; }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (RelatedNotesWebviewProvider.EXCLUDED_DIRS.has(entry.name)) { continue; }
                await this.walkForCandidates(fullPath, currentFile, currentTags, candidates);
            } else if (entry.name.endsWith('.md') && fullPath !== currentFile) {
                try {
                    const content = await fsp.readFile(fullPath, 'utf8');
                    const tags = extractTagsFromContent(content);
                    const overlap = tags.filter(t => currentTags.includes(t)).length;
                    if (overlap > 0) {
                        const summary = extractSummaryFromContent(content);
                        candidates.set(fullPath, { filePath: fullPath, summary, score: overlap });
                    }
                } catch {}
            }
        }
    }

    private async aiRank(currentSummary: string, candidates: RelatedNote[]): Promise<RelatedNote[]> {
        const candidateList = candidates.map((c, i) => {
            const desc = c.summary || path.basename(c.filePath);
            return `${i + 1}. "${desc}"`;
        }).join('\n');

        const prompt = `Given this note summary: "${currentSummary}"

Rank these candidate notes by relevance (most related first). Return ONLY a JSON array of numbers, e.g. [2, 5, 1].

${candidateList}`;

        try {
            const response = await chatCompletionWithRetry(prompt);
            const match = response.match(/\[[\d,\s]+\]/);
            if (match) {
                const indices: number[] = JSON.parse(match[0]);
                const ranked: RelatedNote[] = [];
                for (const idx of indices) {
                    if (idx >= 1 && idx <= candidates.length && ranked.length < 5) {
                        ranked.push(candidates[idx - 1]);
                    }
                }
                return ranked;
            }
        } catch {}

        return candidates.slice(0, 5);
    }

    private getHtml(notes: RelatedNote[]): string {
        if (notes.length === 0) {
            return `<body style="font-family: var(--vscode-font-family); color: var(--vscode-sideBar-foreground); padding: 12px;">
                <i>No related notes found.</i>
            </body>`;
        }

        const items = notes.map(n => {
            const name = path.basename(n.filePath);
            const summaryHtml = n.summary
                ? `<div style="font-size:0.85em; opacity:0.7; margin-top:1px;">${escapeHtml(n.summary)}</div>`
                : '';
            return `<div class="related" data-path="${escapeHtml(n.filePath)}" style="cursor:pointer; padding:4px 8px; border-radius:3px; margin:2px 0;">
                <span style="color:var(--vscode-textLink-foreground);">${escapeHtml(name)}</span>
                ${summaryHtml}
            </div>`;
        }).join('');

        return `<body style="font-family: var(--vscode-font-family); color: var(--vscode-sideBar-foreground); padding: 12px;">
            <div style="font-weight:bold; margin-bottom:8px;">Related Notes (${notes.length})</div>
            ${items}
            <script>
                const vscode = acquireVsCodeApi();
                document.querySelectorAll('.related').forEach(el => {
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
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
        this.disposables.forEach(d => d.dispose());
    }
}
