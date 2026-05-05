import * as vscode from 'vscode';
import { TagCache } from './tagCache';

export class TagCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private tagCache: TagCache) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] | undefined {
        if (!this.isInsideTagsField(document, position)) {
            return undefined;
        }

        const tagsWithFrequency = this.tagCache.getTagsWithFrequency();
        return tagsWithFrequency.map(({ tag, count }) => {
            const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Value);
            item.detail = `used ${count} time${count !== 1 ? 's' : ''}`;
            item.insertText = tag;
            return item;
        });
    }

    private isInsideTagsField(document: vscode.TextDocument, position: vscode.Position): boolean {
        const text = document.getText();
        const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) { return false; }

        const frontmatterEnd = text.indexOf('\n---', 4);
        const frontmatterEndLine = document.positionAt(frontmatterEnd + 4).line;

        if (position.line < 1 || position.line > frontmatterEndLine) {
            return false;
        }

        const line = document.lineAt(position.line).text;
        return /^\s*tags\s*:/.test(line) || /^\s*tags\s*:\s*\[/.test(line);
    }
}
