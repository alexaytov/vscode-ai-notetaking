import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { chatCompletionWithRetry } from './ai';

export function countWords(text: string): number {
    const trimmed = text.trim();
    if (trimmed.length === 0) { return 0; }
    return trimmed.split(/\s+/).length;
}

export function stripFrontmatter(content: string): string {
    return content.replace(/^---\n(?:.*\n)*?---\n/, '');
}

export async function mergeNotes(notePaths: string[], workspaceRoot: string): Promise<string> {
    const contents: string[] = [];
    let totalWords = 0;

    for (const notePath of notePaths) {
        const raw = await fsp.readFile(notePath, 'utf8');
        const cleaned = stripFrontmatter(raw);
        contents.push(`## Source: ${path.basename(notePath)}\n\n${cleaned}`);
        totalWords += countWords(cleaned);
    }

    if (totalWords > 8000) {
        const proceed = await vscode.window.showWarningMessage(
            `Selected notes contain ~${totalWords} words (recommended limit: 8000). Continue?`,
            'Continue',
            'Cancel'
        );
        if (proceed !== 'Continue') {
            throw new Error('Merge cancelled by user.');
        }
    }

    const combined = contents.join('\n\n---\n\n');
    const prompt = `Merge these notes into a single comprehensive document. Preserve all key information, remove redundancy, organize logically with clear headings. Output markdown only.

Notes to merge:

${combined}`;

    const merged = await chatCompletionWithRetry(prompt);

    // Write to _drafts/
    const draftsDir = path.join(workspaceRoot, '_drafts');
    if (!fs.existsSync(draftsDir)) {
        fs.mkdirSync(draftsDir, { recursive: true });
    }

    const date = new Date();
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const fileName = `merged_${dd}-${mm}-${yyyy}_${uuidv4().slice(0, 8)}.md`;
    const outputPath = path.join(draftsDir, fileName);

    await fsp.writeFile(outputPath, merged, 'utf8');
    return outputPath;
}
