"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
// -----------------------------------------------------------------------------------------
// File: extension.ts
// Description: VS Code extension for AI Note Saver.
// Auto-tags and organizes Markdown notes using the OpenAI API.
// -----------------------------------------------------------------------------------------
const vscode = require("vscode");
const openai_1 = require("openai");
const fs = require("fs/promises");
const path = require("path");
/**
 * Called when the extension is activated.
 * Registers commands for saving and reclassifying notes.
 */
function activate(context) {
    // Register commands for saving and reclassifying notes
    context.subscriptions.push(vscode.commands.registerCommand('aiNoteSaver.saveNote', () => handleNote(false)), vscode.commands.registerCommand('aiNoteSaver.reclassifyNote', () => handleNote(true)));
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
/**
 * Read and validate extension configuration.
 * @throws Error if any required setting is missing.
 */
function getExtensionConfig() {
    const cfg = vscode.workspace.getConfiguration('aiNoteSaver');
    const apiKey = cfg.get('openaiApiKey')?.trim();
    const apiUrl = cfg.get('apiUrl')?.trim();
    const model = cfg.get('model')?.trim();
    const rawTarget = cfg.get('targetRoot')?.trim();
    if (!apiKey)
        throw new Error('OpenAI API key not set');
    if (!vscode.workspace.workspaceFolders?.length)
        throw new Error('No workspace folder open');
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const targetRoot = rawTarget.replace(/\$\{workspaceFolder\}/g, workspaceFolder);
    return { apiKey, apiUrl: apiUrl, model: model, targetRoot, workspaceFolder };
}
/**
 * Main handler for both save and reclassify operations.
 * @param reclassify  true for reclassification, false for initial save
 */
async function handleNote(reclassify) {
    // Load and validate configuration
    let apiKey, apiUrl, model, targetRoot, workspaceFolder;
    try {
        ({ apiKey, apiUrl, model, targetRoot, workspaceFolder } = getExtensionConfig());
    }
    catch (err) {
        vscode.window.showErrorMessage(`AI Note Saver: ${err.message}`);
        return;
    }
    // Initialize AI client
    const openai = new openai_1.OpenAI({ apiKey, baseURL: apiUrl });
    // Get active document
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('AI Note Saver: No active editor');
        return;
    }
    const doc = editor.document;
    if (!doc.fileName.endsWith('.md')) {
        vscode.window.showWarningMessage('AI Note Saver: Not a Markdown file');
        return;
    }
    const text = doc.getText();
    try {
        // Extract tags, path, and filename slug via AI
        const tags = await extractTags(openai, model, text);
        const relPath = await generateRelPath(openai, model, tags, text);
        const slug = await generateSlug(openai, model, text);
        const fileName = `${slug}.md`;
        // Move file and insert tags
        await moveAndTagFile(doc, tags, relPath, targetRoot, fileName, reclassify);
    }
    catch (err) {
        vscode.window.showErrorMessage(`AI Note Saver error: ${err.message}`);
    }
}
/**
 * Extract tags from the given text using the AI model.
 * @param openai OpenAI client
 * @param model AI model to use
 * @param text Text to extract tags from
 * @returns Array of extracted tags
 */
async function extractTags(openai, model, text) {
    const tagResp = await openai.chat.completions.create({
        model,
        messages: [
            { role: 'system', content: 'Extract 2-5 concise tags (comma-separated) for this note.' },
            { role: 'user', content: text }
        ]
    });
    const tags = tagResp.choices[0].message.content.split(',').map(t => t.trim());
    vscode.window.showInformationMessage(`AI Note Saver: extracted tags: ${tags.join(', ')}`);
    return tags;
}
/**
 * Generate a relative path for the given tags and text using the AI model.
 * @param openai OpenAI client
 * @param model AI model to use
 * @param tags Tags to use for generating the path
 * @param text Text to use for generating the path
 * @returns Relative path
 */
async function generateRelPath(openai, model, tags, text) {
    const pathResp = await openai.chat.completions.create({
        model,
        messages: [
            { role: 'system', content: `Given tags ${JSON.stringify(tags)}, output a relative folder path under the workspace root directory. Use only lowercase letters, words separated by dashes for folder names, separated by forward slashes, and at most 3 levels (no more than 2 slashes). Output only the path without any explanation.` },
            { role: 'user', content: text }
        ]
    });
    let relPath = pathResp.choices[0].message.content.trim() || '';
    relPath = relPath.split('/').slice(0, 3).map(seg => seg.replace(/_/g, '-')).join('/');
    return relPath;
}
/**
 * Generate a filesystem-safe slug from raw AI response.
 * @param input Raw slug suggestion
 */
function sanitizeSlug(input) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-');
}
/**
 * Find the index of the first Markdown header line.
 */
function getTitleIndex(lines) {
    const idx = lines.findIndex(line => /^\s*#/.test(line));
    return idx < 0 ? 0 : idx;
}
/**
 * Insert a Tags line immediately after the title.
 */
function insertTags(lines, tags) {
    const idx = getTitleIndex(lines);
    const copy = [...lines];
    copy.splice(idx + 1, 0, `Tags: ${tags.join(', ')}`);
    return copy;
}
/**
 * Request an AI-generated slug and sanitize it.
 */
async function generateSlug(openai, model, text) {
    const resp = await openai.chat.completions.create({
        model,
        messages: [
            { role: 'system', content: 'Propose a concise filename slug (lowercase, dash-separated, no extension) based on note content. No extension.' },
            { role: 'user', content: text }
        ]
    });
    const raw = resp.choices[0].message.content.trim();
    return sanitizeSlug(raw) || 'note';
}
/**
 * Move the file to the target location and insert tags.
 * @param doc Document to move
 * @param tags Tags to insert
 * @param relPath Relative path to move to
 * @param targetRoot Target root directory
 * @param fileName New filename
 * @param reclassify Whether this is a reclassify operation
 */
async function moveAndTagFile(doc, tags, relPath, targetRoot, fileName, reclassify) {
    const destDir = path.join(targetRoot, relPath);
    vscode.window.showInformationMessage(`AI Note Saver: generated path: ${destDir}`);
    await fs.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, fileName);
    const origContent = await fs.readFile(doc.fileName, 'utf8');
    let lines = origContent.split(/\r?\n/);
    if (reclassify) {
        // Remove existing Tags lines
        lines = lines.filter(line => !/^Tags:/.test(line));
    }
    // Inject new Tags after title
    lines = insertTags(lines, tags);
    const newContent = lines.join('\n');
    if (destPath === doc.fileName) {
        await fs.writeFile(doc.fileName, newContent, 'utf8');
        vscode.window.showInformationMessage('AI Note Saver: tags updated in-place');
    }
    else {
        await fs.writeFile(destPath, newContent, 'utf8');
        await fs.unlink(doc.fileName);
        await removeEmptyDirsRecursively(path.dirname(doc.fileName));
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await vscode.window.showTextDocument(vscode.Uri.file(destPath), { preview: false });
        vscode.window.showInformationMessage(`AI Note Saver: reclassified to ${destPath}`);
    }
}
/**
 * Remove empty directories up to the workspace root.
 * @param dir Directory to start from
 */
async function removeEmptyDirsRecursively(dir) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let curr = dir;
    while (curr !== workspaceFolder) {
        const entries = await fs.readdir(curr);
        if (entries.length === 0) {
            await fs.rmdir(curr);
            vscode.window.showInformationMessage(`AI Note Saver: removed empty folder ${curr}`);
            curr = path.dirname(curr);
        }
        else {
            break;
        }
    }
}
//# sourceMappingURL=extension.js.map