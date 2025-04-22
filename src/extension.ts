// -----------------------------------------------------------------------------------------
// File: extension.ts
// Description: VS Code extension for AI Note Saver.
// Auto-tags and organizes Markdown notes using the OpenAI API.
// -----------------------------------------------------------------------------------------
import * as vscode from 'vscode';
import { OpenAI } from 'openai';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Called when the extension is activated.
 * Registers commands for saving and reclassifying notes.
 */
export function activate(context: vscode.ExtensionContext) {
  // Register commands for saving and reclassifying notes
  context.subscriptions.push(
    vscode.commands.registerCommand('aiNoteSaver.saveNote', () => handleNote(false)),
    vscode.commands.registerCommand('aiNoteSaver.reclassifyNote', () => handleNote(true))
  );
}

export function deactivate() {}

/**
 * Read and validate extension configuration.
 * @throws Error if any required setting is missing.
 */
function getExtensionConfig(): { apiKey: string; apiUrl: string; model: string; targetRoot: string; workspaceFolder: string } {
  const cfg = vscode.workspace.getConfiguration('aiNoteSaver');
  const apiKey = cfg.get<string>('openaiApiKey')?.trim();
  const apiUrl = cfg.get<string>('apiUrl')?.trim();
  const model = cfg.get<string>('model')?.trim();
  const rawTarget = cfg.get<string>('targetRoot')?.trim();
  if (!apiKey) throw new Error('OpenAI API key not set');
  if (!vscode.workspace.workspaceFolders?.length) throw new Error('No workspace folder open');
  const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const targetRoot = rawTarget!.replace(/\$\{workspaceFolder\}/g, workspaceFolder);
  return { apiKey, apiUrl: apiUrl!, model: model!, targetRoot, workspaceFolder };
}

/**
 * Main handler for both save and reclassify operations.
 * @param reclassify  true for reclassification, false for initial save
 */
async function handleNote(reclassify: boolean) {
  // Load and validate configuration
  let apiKey: string, apiUrl: string, model: string, targetRoot: string, workspaceFolder: string;
  try {
    ({ apiKey, apiUrl, model, targetRoot, workspaceFolder } = getExtensionConfig());
  } catch (err: any) {
    vscode.window.showErrorMessage(`AI Note Saver: ${err.message}`);
    return;
  }

  // Initialize AI client
  const openai = new OpenAI({ apiKey, baseURL: apiUrl });

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

    // Allow user to edit tags, path, and filename
    const editedTagsInput = await vscode.window.showInputBox({
      prompt: 'Edit tags (comma-separated)',
      value: tags.join(', ')
    });
    if (editedTagsInput === undefined) {
      vscode.window.showInformationMessage('AI Note Saver: operation cancelled');
      return;
    }
    const finalTags = editedTagsInput.split(',').map(t => t.trim()).filter(t => t);

    // Prompt user for relative path
    const editedRelPath = await vscode.window.showInputBox({
      prompt: 'Edit relative path under workspace',
      value: relPath
    });
    if (editedRelPath === undefined) {
      vscode.window.showInformationMessage('AI Note Saver: operation cancelled');
      return;
    }
    const finalRelPath = editedRelPath.trim();

    // Prompt user for file name
    const editedFileName = await vscode.window.showInputBox({
      prompt: 'Edit file name (include .md)',
      value: fileName
    });
    if (editedFileName === undefined) {
      vscode.window.showInformationMessage('AI Note Saver: operation cancelled');
      return;
    }
    let finalFileName = editedFileName.trim();
    if (!finalFileName.toLowerCase().endsWith('.md')) {
      finalFileName += '.md';
    }

    // Move file and insert tags
    await moveAndTagFile(doc, finalTags, finalRelPath, targetRoot, finalFileName, reclassify);
  } catch (err: any) {
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
async function extractTags(openai: OpenAI, model: string, text: string) {
  const tagResp = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'Extract 2-5 concise tags (comma-separated) for this note.' },
      { role: 'user', content: text }
    ]
  });
  const tags = tagResp.choices[0].message!.content!.split(',').map(t => t.trim());
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
async function generateRelPath(openai: OpenAI, model: string, tags: string[], text: string) {
  const pathResp = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: `Given tags ${JSON.stringify(tags)}, output a relative folder path under the workspace root directory. Use only lowercase letters, words separated by dashes for folder names, separated by forward slashes, and at most 3 levels (no more than 2 slashes). Output only the path without any explanation.` },
      { role: 'user', content: text }
    ]
  });
  let relPath = pathResp.choices[0].message!.content!.trim() || '';
  relPath = relPath.split('/').slice(0, 3).map(seg => seg.replace(/_/g, '-')).join('/');
  return relPath;
}

/**
 * Generate a filesystem-safe slug from raw AI response.
 * @param input Raw slug suggestion
 */
function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

/**
 * Find the index of the first Markdown header line.
 */
function getTitleIndex(lines: string[]): number {
  const idx = lines.findIndex(line => /^\s*#/.test(line));
  return idx < 0 ? 0 : idx;
}

/**
 * Insert a Tags line immediately after the title.
 */
function insertTags(lines: string[], tags: string[]): string[] {
  const idx = getTitleIndex(lines);
  const copy = [...lines];
  copy.splice(idx + 1, 0, `Tags: ${tags.join(', ')}`);
  return copy;
}

/**
 * Request an AI-generated slug and sanitize it.
 */
async function generateSlug(openai: OpenAI, model: string, text: string): Promise<string> {
  const resp = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'Propose a concise filename slug (lowercase, dash-separated, no extension) based on note content. No extension.' },
      { role: 'user', content: text }
    ]
  });
  const raw = resp.choices[0].message!.content!.trim();
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
async function moveAndTagFile(doc: vscode.TextDocument, tags: string[], relPath: string, targetRoot: string, fileName: string, reclassify: boolean) {
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
  } else {
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
async function removeEmptyDirsRecursively(dir: string) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let curr = dir;
  while (curr !== workspaceFolder) {
    const entries = await fs.readdir(curr);
    if (entries.length === 0) {
      await fs.rmdir(curr);
      vscode.window.showInformationMessage(`AI Note Saver: removed empty folder ${curr}`);
      curr = path.dirname(curr);
    } else {
      break;
    }
  }
}
