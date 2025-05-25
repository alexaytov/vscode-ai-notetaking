import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class NotesByTagWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiNotesByTagWebView';
    private _view?: vscode.WebviewView;

    constructor(private workspaceRoot: string) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };

        webviewView.webview.html = this.getHtmlForWebview('');

        webviewView.webview.onDidReceiveMessage(async message => {
            if (message.command === 'filter') {
                const filter = message.text.trim();
                webviewView.webview.html = this.getHtmlForWebview(filter);
            }
            if (message.command === 'openNote') {
                const uri = vscode.Uri.file(message.path);
                vscode.window.showTextDocument(uri);
            }
        });
    }

    private getHtmlForWebview(filter: string): string {
        const notesByTag = this.getNotesByTagSync(filter);
        const tags = Object.keys(notesByTag).sort();
        return `
            <style>
                body { font-family: var(--vscode-font-family); background: var(--vscode-sideBar-background); color: var(--vscode-sideBar-foreground); }
                .tag {
                    font-weight: bold;
                    margin-top: 1em;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    user-select: none;
                    transition: background 0.2s;
                    border-radius: 4px;
                    padding: 2px 4px;
                }
                .tag:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                .tag .arrow {
                    margin-right: 6px;
                    font-size: 0.9em;
                    transition: transform 0.2s;
                }
                .tag.collapsed .arrow {
                    transform: rotate(-90deg);
                }
                .note {
                    margin-left: 1.5em;
                    cursor: pointer;
                    color: var(--vscode-textLink-foreground);
                    border-radius: 3px;
                    padding: 1px 4px;
                    transition: background 0.2s;
                }
                .note:hover {
                    background: var(--vscode-list-hoverBackground);
                    text-decoration: underline;
                }
                .filter-bar {
                    display: flex;
                    align-items: center;
                    margin-bottom: 8px;
                }
                #filter {
                    flex: 1;
                    padding: 4px 8px;
                    border-radius: 4px;
                    border: 1px solid var(--vscode-input-border);
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                }
                .icon-search {
                    margin-right: 6px;
                    color: var(--vscode-icon-foreground);
                }
            </style>
            <div class="filter-bar">
                <span class="icon-search">🔍</span>
                <input id="filter" type="text" placeholder="Filter tags..." value="${filter}" />
                <button id="expandAll" title="Expand all tags" style="margin-left:8px;">expand</button>
                <button id="collapseAll" title="Collapse all tags" style="margin-left:2px;">collapse</button>
                <button id="refreshTags" title="Refresh tags" style="margin-left:8px;">⟳</button>
            </div>
            <div id="tags-list">
                ${tags.length === 0 ? '<i>No tags found.</i>' : tags.map(tag => `
                    <div class="tag collapsed" data-tag="${tag}"><span class="arrow">▼</span>${tag}</div>
                    <div class="notes" data-tag-notes="${tag.replace(/"/g, '&quot;')}" style="display:none;">
                        ${notesByTag[tag].map(note => `
                            <div class="note" data-path="${note}">${path.basename(note)}</div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const filterInput = document.getElementById('filter');
                let lastSent = filterInput.value;
                let lastSelectionStart = filterInput.selectionStart;
                let lastSelectionEnd = filterInput.selectionEnd;

                // Only send filter on Enter key
                filterInput.addEventListener('keydown', e => {
                    if (e.key === 'Enter') {
                        lastSent = filterInput.value;
                        lastSelectionStart = filterInput.selectionStart;
                        lastSelectionEnd = filterInput.selectionEnd;
                        vscode.postMessage({ command: 'filter', text: filterInput.value, selectionStart: lastSelectionStart, selectionEnd: lastSelectionEnd });
                    }
                });

                // Collapsible tags
                document.querySelectorAll('.tag').forEach(function(tagEl) {
                    tagEl.addEventListener('click', function() {
                        var tag = tagEl.getAttribute('data-tag');
                        var notesEl = document.querySelector('[data-tag-notes="' + tag.replace(/"/g, '\\"') + '"]');
                        var arrow = tagEl.querySelector('.arrow');
                        if (notesEl.style.display === 'none') {
                            notesEl.style.display = '';
                            tagEl.classList.remove('collapsed');
                        } else {
                            notesEl.style.display = 'none';
                            tagEl.classList.add('collapsed');
                        }
                    });
                });

                // Expand all/collapse all buttons
                document.getElementById('expandAll').addEventListener('click', function() {
                    document.querySelectorAll('.tag').forEach(function(tagEl) {
                        var tag = tagEl.getAttribute('data-tag');
                        var notesEl = document.querySelector('[data-tag-notes="' + tag.replace(/"/g, '\\"') + '"]');
                        notesEl.style.display = '';
                        tagEl.classList.remove('collapsed');
                    });
                });
                document.getElementById('collapseAll').addEventListener('click', function() {
                    document.querySelectorAll('.tag').forEach(function(tagEl) {
                        var tag = tagEl.getAttribute('data-tag');
                        var notesEl = document.querySelector('[data-tag-notes="' + tag.replace(/"/g, '\\"') + '"]');
                        notesEl.style.display = 'none';
                        tagEl.classList.add('collapsed');
                    });
                });
                // Refresh button
                document.getElementById('refreshTags').addEventListener('click', function() {
                    vscode.postMessage({ command: 'filter', text: filterInput.value, selectionStart: filterInput.selectionStart, selectionEnd: filterInput.selectionEnd });
                });

                // Restore focus and cursor position after HTML update
                window.addEventListener('DOMContentLoaded', function() {
                    filterInput.focus();
                    var state = vscode.getState();
                    if (state && typeof state.selectionStart === 'number' && typeof state.selectionEnd === 'number') {
                        filterInput.setSelectionRange(state.selectionStart, state.selectionEnd);
                    } else {
                        filterInput.setSelectionRange(filterInput.value.length, filterInput.value.length);
                    }
                });

                window.addEventListener('message', function(event) {
                    var message = event.data;
                    if (message.command === 'saveState') {
                        vscode.setState({
                            selectionStart: message.selectionStart,
                            selectionEnd: message.selectionEnd
                        });
                    }
                });

                document.querySelectorAll('.note').forEach(function(el) {
                    el.addEventListener('click', function() {
                        vscode.postMessage({ command: 'openNote', path: el.getAttribute('data-path') });
                    });
                });
            </script>
        `;
    }

    // Synchronous for simplicity; for large workspaces, use async and debounce/filter in JS
    private getNotesByTagSync(filter: string): Record<string, string[]> {
        const notesByTag: Record<string, string[]> = {};
        function walk(dir: string) {
            for (const file of fs.readdirSync(dir)) {
                const fullPath = path.join(dir, file);
                if (fs.statSync(fullPath).isDirectory()) {
                    walk(fullPath);
                } else if (file.endsWith('.md')) {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const match = content.match(/^---\n([\s\S]*?)\n---/);
                    if (match) {
                        const yaml = match[1];
                        const tagsLine = yaml.split('\n').find(line => line.trim().startsWith('tags:'));
                        if (tagsLine) {
                            const tagsMatch = tagsLine.match(/\[(.*?)\]/);
                            if (tagsMatch) {
                                const tags = tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
                                for (const tag of tags) {
                                    if (!filter || tag.includes(filter)) {
                                        if (!notesByTag[tag]) {notesByTag[tag] = [];}
                                        notesByTag[tag].push(fullPath);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        walk(this.workspaceRoot);
        return notesByTag;
    }
}