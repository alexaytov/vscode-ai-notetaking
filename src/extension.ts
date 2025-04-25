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
  if (doc.languageId !== 'markdown') {
    vscode.window.showWarningMessage('AI Note Saver: Not a Markdown file');
    return;
  }

  // Use in-memory text so it works for unsaved/untitled files
  const text = doc.getText();
  try {
    // Extract tags, path, and filename slug via AI
    const tags = await extractTags(openai, model, text);
    const relPath = await generateRelPath(openai, model, tags, text, targetRoot);
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
    // const editedRelPath = await vscode.window.showInputBox({
    //   prompt: 'Edit relative path under workspace',
    //   value: relPath
    // });
    // if (editedRelPath === undefined) {
    //   vscode.window.showInformationMessage('AI Note Saver: operation cancelled');
    //   return;
    // }
    // const finalRelPath = editedRelPath.trim();

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
    await moveAndTagFile(doc, finalTags, relPath, targetRoot, finalFileName, reclassify, text);
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
      { role: 'system', content: 'Extract 2-3 concise tags (comma-separated) based on the core contents of this node.' },
      { role: 'user', content: text }
    ]
  });
  const tags = tagResp.choices[0].message!.content!.split(',').map(t => t.trim());
  vscode.window.showInformationMessage(`AI Note Saver: extracted tags: ${tags.join(', ')}`);
  return tags;
}

/**
 * Generate a relative path for the given tags and text using the AI model.
 * Suggests an existing folder if appropriate, or creates a new one if needed.
 * @param openai OpenAI client
 * @param model AI model to use
 * @param tags Tags to use for generating the path
 * @param text Text to use for generating the path
 * @param targetRoot The root directory under which to categorize notes
 * @returns Relative path
 */
async function generateRelPath(openai: OpenAI, model: string, tags: string[], text: string, targetRoot: string) {
  // 1. List all subfolders under targetRoot (up to 3 levels)
  const getAllFolders = async (root: string, depth = 3, prefix = ''): Promise<string[]> => {
    if (depth === 0) return [];
    let result: string[] = [];
    try {
      const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const rel = path.join(prefix, entry.name);
          result.push(rel);
          result = result.concat(await getAllFolders(root, depth - 1, rel));
        }
      }
    } catch (e) {}
    return result;
  };
  const existingFolders = await getAllFolders(targetRoot);

  // 2. Ask AI for a suggested relative path
  const pathResp = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: `Given tags ${JSON.stringify(tags)}, output a relative folder path under the workspace root directory. Use only lowercase letters, words separated by dashes for folder names, separated by forward slashes, and at most 3 levels (no more than 2 slashes). Output only the path without any explanation.` },
      { role: 'user', content: text }
    ]
  });
  let aiPath = pathResp.choices[0].message!.content!.trim() || '';
  aiPath = aiPath.split('/').slice(0, 3).map(seg => seg.replace(/_/g, '-')).join('/');

  // 3. Find top N (e.g., 3) most similar existing folders
  const normalize = (s: string) => s.replace(/_/g, '-').toLowerCase();
  function similarity(a: string, b: string) {
    // Simple similarity: count of matching segments from start
    const aSegs = normalize(a).split(path.sep);
    const bSegs = normalize(b).split(path.sep);
    let score = 0;
    for (let i = 0; i < Math.min(aSegs.length, bSegs.length); i++) {
      if (aSegs[i] === bSegs[i]) score++;
      else break;
    }
    // Prefer longer matches, but penalize for extra segments
    return score * 2 - Math.abs(aSegs.length - bSegs.length);
  }
  const folderScores = existingFolders.map(f => ({ folder: f, score: similarity(f, aiPath) }));
  folderScores.sort((a, b) => b.score - a.score);
  const topMatches = folderScores.filter(f => f.score > 0).slice(0, 3);

  // 4. Let user pick: top matches, AI suggestion, or custom
  let options = [];
  for (const match of topMatches) {
    options.push({ label: `Use existing folder: ${match.folder}`, value: match.folder });
  }
  options.push({ label: `Create new folder: ${aiPath}`, value: aiPath });
  options.push({ label: 'Other (specify manually)', value: '__other__' });
  const picked = await vscode.window.showQuickPick(options, { placeHolder: 'Select a folder to categorize this note' });
  if (!picked) return aiPath;
  if (picked.value === '__other__') {
    const manual = await vscode.window.showInputBox({ prompt: 'Enter relative folder path under workspace', value: aiPath });
    return manual?.trim() || aiPath;
  }
  return picked.value;
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
 * @param inMemoryText Optional: in-memory text for unsaved/untitled docs
 */
async function moveAndTagFile(doc: vscode.TextDocument, tags: string[], relPath: string, targetRoot: string, fileName: string, reclassify: boolean, inMemoryText?: string) {
  const destDir = path.join(targetRoot, relPath);
  vscode.window.showInformationMessage(`AI Note Saver: generated path: ${destDir}`);
  await fs.mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, fileName);
  let origContent: string;
  if (doc.isUntitled && inMemoryText !== undefined) {
    // Use in-memory content for unsaved/untitled docs
    origContent = inMemoryText;
  } else {
    origContent = await fs.readFile(doc.fileName, 'utf8');
  }
  let lines = origContent.split(/\r?\n/);
  if (reclassify) {
    // Remove existing Tags lines
    lines = lines.filter(line => !/^Tags:/.test(line));
  }
  // Inject new Tags after title
  lines = insertTags(lines, tags);
  const newContent = lines.join('\n');
  await fs.writeFile(destPath, newContent, 'utf8');
  if (!doc.isUntitled && !doc.isDirty && destPath !== doc.fileName) {
    // Only close the old tab if the doc is saved and unmodified
    await fs.unlink(doc.fileName);
    await removeEmptyDirsRecursively(path.dirname(doc.fileName));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.window.showTextDocument(vscode.Uri.file(destPath), { preview: false });
    vscode.window.showInformationMessage(`AI Note Saver: reclassified to ${destPath}`);
  } else {
    // For untitled/unsaved/dirty docs, just open the new file and leave the old tab open
    await vscode.window.showTextDocument(vscode.Uri.file(destPath), { preview: false });
    vscode.window.showInformationMessage(`AI Note Saver: note saved to ${destPath}`);
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
