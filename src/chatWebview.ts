import * as vscode from 'vscode';
import * as path from 'path';
import { chatCompletionWithRetry } from './ai';
import { gatherNotes, NoteInfo, buildNoteEntry } from './semanticSearch';

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiNotesChatWebView';
    private view?: vscode.WebviewView;
    private history: ChatMessage[] = [];
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(async message => {
            if (message.command === 'sendMessage') {
                await this.handleUserMessage(message.text);
            }
            if (message.command === 'clear') {
                this.history = [];
                this.updateChat();
            }
            if (message.command === 'openNote') {
                const uri = vscode.Uri.file(message.path);
                vscode.window.showTextDocument(uri);
            }
        });
    }

    private async handleUserMessage(text: string): Promise<void> {
        this.history.push({ role: 'user', content: text });
        this.updateChat();

        try {
            const notes = await gatherNotes(this.workspaceRoot);
            const context = this.buildContext(notes);
            const conversationHistory = this.history.slice(-20).map(m =>
                `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
            ).join('\n\n');

            const prompt = `You are a helpful assistant that answers questions about the user's notes. Cite referenced notes by filename in square brackets like [filename.md].

Available notes:
${context}

Conversation:
${conversationHistory}

Answer the user's latest question based on the notes above.`;

            const response = await chatCompletionWithRetry(prompt);
            this.history.push({ role: 'assistant', content: response });
        } catch (err: any) {
            this.history.push({ role: 'assistant', content: `Error: ${err.message}` });
        }

        this.updateChat();
    }

    private buildContext(notes: NoteInfo[]): string {
        return notes.map(n => {
            const entry = buildNoteEntry(n.filePath, n.summary, n.snippet);
            return entry;
        }).join('\n');
    }

    private updateChat(): void {
        if (!this.view) { return; }
        this.view.webview.html = this.getHtml();
    }

    private renderMessages(): string {
        return this.history.map(m => {
            const cls = m.role === 'user' ? 'user-msg' : 'ai-msg';
            const label = m.role === 'user' ? 'You' : 'AI';
            const content = this.renderContent(m.content);
            return `<div class="msg ${cls}"><strong>${label}:</strong> ${content}</div>`;
        }).join('');
    }

    private renderContent(content: string): string {
        const escaped = escapeHtml(content);
        return escaped.replace(/\[([^\]]+\.md)\]/g, (match, filename) => {
            return `<span class="note-ref" data-filename="${escapeHtml(filename)}">[${escapeHtml(filename)}]</span>`;
        });
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html>
<head>
<style>
    body { font-family: var(--vscode-font-family); background: var(--vscode-sideBar-background); color: var(--vscode-sideBar-foreground); margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; }
    #messages { flex: 1; overflow-y: auto; padding: 12px; }
    .msg { margin-bottom: 12px; padding: 8px; border-radius: 6px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word; }
    .user-msg { background: var(--vscode-input-background); }
    .ai-msg { background: var(--vscode-editor-background); }
    .note-ref { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; }
    #input-area { padding: 8px; border-top: 1px solid var(--vscode-input-border); display: flex; gap: 4px; }
    #input { flex: 1; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-size: 0.95em; }
    #sendBtn, #clearBtn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 0.9em; }
    #sendBtn:hover, #clearBtn:hover { background: var(--vscode-button-hoverBackground); }
    #clearBtn { background: none; color: var(--vscode-textLink-foreground); padding: 6px 8px; }
</style>
</head>
<body>
    <div id="messages">${this.renderMessages()}</div>
    <div id="input-area">
        <input id="input" type="text" placeholder="Ask about your notes..." />
        <button id="sendBtn">Send</button>
        <button id="clearBtn">Clear</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();

        document.getElementById('sendBtn').addEventListener('click', send);
        document.getElementById('input').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { send(); }
        });
        document.getElementById('clearBtn').addEventListener('click', function() {
            vscode.postMessage({ command: 'clear' });
        });

        function send() {
            const input = document.getElementById('input');
            const text = input.value.trim();
            if (!text) { return; }
            input.value = '';
            vscode.postMessage({ command: 'sendMessage', text: text });
        }

        document.querySelectorAll('.note-ref').forEach(function(el) {
            el.addEventListener('click', function() {
                vscode.postMessage({ command: 'openNote', path: el.getAttribute('data-filename') });
            });
        });

        // Scroll to bottom
        const msgs = document.getElementById('messages');
        msgs.scrollTop = msgs.scrollHeight;
    </script>
</body>
</html>`;
    }
}
