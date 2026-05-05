import * as vscode from 'vscode';

export class AutoClassifyWatcher {
    private disposables: vscode.Disposable[] = [];
    private dismissed: Set<string> = new Set();
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private classifyCallback: (doc: vscode.TextDocument) => Promise<void>;

    constructor(
        private draftsDir: string,
        classifyCallback: (doc: vscode.TextDocument) => Promise<void>
    ) {
        this.classifyCallback = classifyCallback;
    }

    start(): void {
        const listener = vscode.workspace.onDidSaveTextDocument(doc => {
            this.onSave(doc);
        });
        this.disposables.push(listener);

        const closeListener = vscode.workspace.onDidCloseTextDocument(doc => {
            this.dismissed.delete(doc.uri.fsPath);
        });
        this.disposables.push(closeListener);
    }

    private onSave(doc: vscode.TextDocument): void {
        const filePath = doc.uri.fsPath;

        if (!filePath.startsWith(this.draftsDir)) { return; }
        if (!filePath.endsWith('.md')) { return; }

        const content = doc.getText().trim();
        if (content.length === 0) { return; }

        if (this.hasTags(content)) { return; }
        if (this.dismissed.has(filePath)) { return; }

        const existing = this.debounceTimers.get(filePath);
        if (existing) { return; }

        const timer = setTimeout(() => {
            this.debounceTimers.delete(filePath);
        }, 5000);
        this.debounceTimers.set(filePath, timer);

        this.showClassifyPrompt(doc);
    }

    private hasTags(content: string): boolean {
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) { return false; }
        return match[1].includes('tags:');
    }

    private async showClassifyPrompt(doc: vscode.TextDocument): Promise<void> {
        const action = await vscode.window.showInformationMessage(
            'Classify this note with AI?',
            'Yes',
            'Later'
        );

        if (action === 'Yes') {
            await this.classifyCallback(doc);
        } else {
            this.dismissed.add(doc.uri.fsPath);
        }
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
    }
}
