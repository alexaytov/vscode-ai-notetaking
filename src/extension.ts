// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid'; // npm install uuid
import { getAllFolders } from './files';
import { generateNoteMetadata } from './ai';
import { upsertFrontmatterKey } from './frontmatter';
import { NotesByTagWebviewProvider } from './notesByTagWebview';
import { exportMarkdownToPdf } from './pdf-export';
import { TagCache } from './tagCache';
import { TagCompletionProvider } from './tagCompletionProvider';
import { discoverTemplates, loadTemplateContent, expandTemplateVariables } from './templates';
import { AutoClassifyWatcher } from './autoClassify';
import { BacklinksWebviewProvider } from './backlinksWebview';
import { generateSummary } from './summaries';

// Helper to format a timestamp as dd-mm-yyyy
function formatDateDDMMYYYY(timestamp: number): string {
	const date = new Date(timestamp);
	const dd = String(date.getDate()).padStart(2, '0');
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const yyyy = date.getFullYear();
	return `${dd}-${mm}-${yyyy}`;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// The command has been defined in the package.json file
	const newNoteDisposable = vscode.commands.registerCommand('ai-notes.newNote', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			vscode.window.showErrorMessage('No workspace folder open.');
			return;
		}
		const rootDir = workspaceFolders[0].uri.fsPath;
		const draftsDir = path.join(rootDir, '_drafts');
		if (!fs.existsSync(draftsDir)) {
			fs.mkdirSync(draftsDir, { recursive: true });
		}

		// Template selection
		const templates = await discoverTemplates(context.extensionPath, rootDir);
		const items: vscode.QuickPickItem[] = [
			{ label: 'Blank note', description: 'Start with an empty file' },
			...templates.map(t => ({
				label: t.name,
				description: t.source === 'built-in' ? 'Built-in template' : 'Workspace template',
				detail: t.filePath,
			})),
		];

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Choose a template for your new note',
		});
		if (!selected) { return; }

		let initialContent = '';
		if (selected.detail) {
			const raw = await loadTemplateContent(selected.detail);
			initialContent = expandTemplateVariables(raw);
		}

		const guid = uuidv4();
		const fileName = `${formatDateDDMMYYYY(Date.now())}_${guid}.md`;
		const filePath = path.join(draftsDir, fileName);
		const fileUri = vscode.Uri.file(filePath);

		await vscode.workspace.fs.writeFile(fileUri, Buffer.from(initialContent, 'utf8'));
		const doc = await vscode.workspace.openTextDocument(fileUri);
		await vscode.window.showTextDocument(doc);

	});

	const reclassifyNoteDisposable = vscode.commands.registerCommand('ai-notes.reclassifyNote', async () => {
		const editor = vscode.window.activeTextEditor;
		const workspaceFolders = vscode.workspace.workspaceFolders;

		if (!workspaceFolders) {
			vscode.window.showErrorMessage('No workspace folder open.');
			return;
		}

		if (!editor) {
			vscode.window.showErrorMessage('No active editor found.');
			return;
		}

		const rootDir = workspaceFolders[0].uri.fsPath;
		const doc = editor.document;
		const content = doc.getText();

		// remove yaml frontmatter if it exists
		const yamlRegex = /^---\n(?:.*\n)*?---\n/;
		const cleanedContent = content.replace(yamlRegex, '');

		const existingFolders = await getAllFolders(rootDir, 3);
		const metadata = await generateNoteMetadata(cleanedContent, existingFolders);

		if (!metadata || !metadata.tags || !metadata.name || !metadata.path) {
			vscode.window.showErrorMessage('AI categorization failed, please try again.');
			return;
		}

		// Use the new promptUserForNoteMetadata function
		const userMetadata = await promptUserForNoteMetadata(metadata, existingFolders, rootDir);
		if (!userMetadata) {
			return;
		}

		const { tags, directory, name } = userMetadata;

		// Update tags
		await upsertFrontmatterKey(doc, 'tags', tags);

		// Make sure the new directory exists
		if (!fs.existsSync(directory)) {
			fs.mkdirSync(directory, { recursive: true });
		}

		// Rename the file with the new name and current date
		const formattedDate = formatDateDDMMYYYY(Date.now());
		const newFileName = `${name}_${formattedDate}.md`;
		const newFilePath = path.join(directory, newFileName);
		const newFileUri = vscode.Uri.file(newFilePath);
		await vscode.workspace.fs.rename(doc.uri, newFileUri, { overwrite: false });
		await vscode.window.showTextDocument(newFileUri);

		await removeEmptyDirsRecursively(path.dirname(doc.uri.fsPath));

		return;
	});

	context.subscriptions.push(newNoteDisposable);
	context.subscriptions.push(reclassifyNoteDisposable);

	// Register the test input webview view
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders) {
		const notesByTagProvider = new NotesByTagWebviewProvider(workspaceFolders[0].uri.fsPath);
		notesByTagProvider.onBulkReclassify = (paths) => {
			bulkReclassifyNotes(paths, workspaceFolders[0].uri.fsPath);
		};
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				NotesByTagWebviewProvider.viewType,
				notesByTagProvider
			)
		);

		// Tag autocomplete
		const tagCache = new TagCache(workspaceFolders[0].uri.fsPath);
		tagCache.initialize().catch(() => {});
		context.subscriptions.push(tagCache);
		context.subscriptions.push(
			vscode.languages.registerCompletionItemProvider(
				{ language: 'markdown', scheme: 'file' },
				new TagCompletionProvider(tagCache),
				',', ' '
			)
		);

		// Auto-classify on save in _drafts/
		const draftsDir = path.join(workspaceFolders[0].uri.fsPath, '_drafts');
		const autoClassify = new AutoClassifyWatcher(draftsDir, async (doc) => {
			await classifyAndMoveNote(doc, workspaceFolders[0].uri.fsPath);
		});
		autoClassify.start();
		context.subscriptions.push(autoClassify);

		// Backlinks panel
		const backlinksProvider = new BacklinksWebviewProvider(workspaceFolders[0].uri.fsPath);
		backlinksProvider.initialize().catch(() => {});
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				BacklinksWebviewProvider.viewType,
				backlinksProvider
			)
		);
		context.subscriptions.push(backlinksProvider);
	}

	// Register the export to PDF command
	const exportToPdfDisposable = vscode.commands.registerCommand('ai-notes.exportToPdf', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !editor.document.fileName.endsWith('.md')) {
			vscode.window.showErrorMessage('No Markdown file open.');
			return;
		}
		await exportMarkdownToPdf(editor.document.fileName);
	});
	context.subscriptions.push(exportToPdfDisposable);

	// Reveal in Finder (cross-platform)
	const revealInFinderDisposable = vscode.commands.registerCommand('ai-notes.revealInFileExplorer', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('No active editor found.');
			return;
		}
		const filePath = editor.document.fileName;
		const fileUri = vscode.Uri.file(filePath);
		await vscode.commands.executeCommand('revealFileInOS', fileUri);
	});
	context.subscriptions.push(revealInFinderDisposable);

	// Generate summary command
	const generateSummaryDisposable = vscode.commands.registerCommand('ai-notes.generateSummary', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !editor.document.fileName.endsWith('.md')) {
			vscode.window.showErrorMessage('No Markdown file open.');
			return;
		}

		const doc = editor.document;
		const content = doc.getText();
		const yamlRegex = /^---\n(?:.*\n)*?---\n/;
		const cleanedContent = content.replace(yamlRegex, '');

		if (cleanedContent.trim().length === 0) {
			vscode.window.showErrorMessage('Note has no content to summarize.');
			return;
		}

		try {
			const summary = await generateSummary(cleanedContent);
			await upsertFrontmatterKey(doc, 'summary', `"${summary}"`);
			vscode.window.showInformationMessage(`Summary generated: ${summary}`);
		} catch (err: any) {
			vscode.window.showErrorMessage(`Summary generation failed: ${err.message}`);
		}
	});
	context.subscriptions.push(generateSummaryDisposable);
}

async function bulkReclassifyNotes(paths: string[], rootDir: string): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Bulk Reclassify',
            cancellable: true,
        },
        async (progress, token) => {
            for (let i = 0; i < paths.length; i++) {
                if (token.isCancellationRequested) { break; }

                const notePath = paths[i];
                progress.report({
                    message: `Processing ${i + 1} of ${paths.length}: ${path.basename(notePath)}`,
                    increment: (1 / paths.length) * 100,
                });

                try {
                    const doc = await vscode.workspace.openTextDocument(notePath);
                    await classifyAndMoveNote(doc, rootDir);
                } catch (err: any) {
                    const action = await vscode.window.showWarningMessage(
                        `Failed to classify ${path.basename(notePath)}: ${err.message}`,
                        'Continue',
                        'Stop'
                    );
                    if (action === 'Stop') { break; }
                }
            }
        }
    );
}

async function classifyAndMoveNote(doc: vscode.TextDocument, rootDir: string): Promise<void> {
    const content = doc.getText();
    const yamlRegex = /^---\n(?:.*\n)*?---\n/;
    const cleanedContent = content.replace(yamlRegex, '');

    const existingFolders = await getAllFolders(rootDir, 3);
    const metadata = await generateNoteMetadata(cleanedContent, existingFolders);

    if (!metadata || !metadata.tags || !metadata.name || !metadata.path) {
        vscode.window.showErrorMessage('AI categorization failed, please try again.');
        return;
    }

    const userMetadata = await promptUserForNoteMetadata(metadata, existingFolders, rootDir);
    if (!userMetadata) { return; }

    const { tags, directory, name } = userMetadata;

    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }

    const formattedDate = formatDateDDMMYYYY(Date.now());
    const newFileName = `${name}_${formattedDate}.md`;
    const newFilePath = path.join(directory, newFileName);
    const newFileUri = vscode.Uri.file(newFilePath);

    await upsertFrontmatterKey(doc, 'tags', tags);
    await vscode.workspace.fs.rename(doc.uri, newFileUri, { overwrite: false });
    await vscode.window.showTextDocument(newFileUri);
}

/**
 * Prompts the user for tags, directory, and name, using AI metadata as suggestions.
 * Returns { tags, directory, name } or undefined if cancelled.
 */
async function promptUserForNoteMetadata(metadata: { tags: string[]; name: string; path: string }, existingFolders: string[], rootDir: string): Promise<{ tags: string[]; directory: string; name: string } | undefined> {
    // Prompt for tags
    const tagInput = await vscode.window.showInputBox({
        prompt: 'Suggested tags (comma separated, single words, lowercase)',
        value: metadata.tags.join(', ')
    });
    if (!tagInput) {
        vscode.window.showErrorMessage('No tags selected, operation cancelled.');
        return undefined;
    }
    const selectedTags = tagInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);

    // Prompt for directory
    let options = [];
    if (metadata.path && existingFolders.includes(metadata.path)) {
        options.push({ label: `Use existing folder: ${metadata.path}`, value: metadata.path });
    } else if (metadata.path) {
        options.push({ label: `Create new folder: ${metadata.path}`, value: metadata.path });
    }
    options.push({ label: 'Other (specify manually)', value: '__other__' });
    const picked = await vscode.window.showQuickPick(options, { placeHolder: 'Select a folder to categorize this note' });
    let selectedPath: string | undefined;
    if (!picked) {
        vscode.window.showErrorMessage('No path selected, operation cancelled.');
        return undefined;
    }
    if (picked.value === '__other__') {
        const manual = await vscode.window.showInputBox({ prompt: 'Enter relative folder path under workspace', value: metadata.path });
        if (!manual) {
            vscode.window.showErrorMessage('No path selected, operation cancelled.');
            return undefined;
        }
        selectedPath = path.join(rootDir, manual.trim());
    } else {
        selectedPath = path.join(rootDir, picked.value);
    }

    // Prompt for name
    const finalName = await vscode.window.showInputBox({
        prompt: 'Suggested note name',
        value: metadata.name || '',
        placeHolder: 'Note name'
    });
    if (!finalName) {
        vscode.window.showErrorMessage('No name provided, operation cancelled.');
        return undefined;
    }

    return { tags: selectedTags, directory: selectedPath, name: finalName };
}

/**
 * Remove empty directories up to the workspace root.
 * @param dir Directory to start from
 */
async function removeEmptyDirsRecursively(dir: string) {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	let curr = dir;
	while (curr !== workspaceFolder) {
		const entries = await fs.promises.readdir(curr);
		if (entries.length === 0) {
			await fs.promises.rmdir(curr);
			vscode.window.showInformationMessage(`AI Note Saver: removed empty folder ${curr}`);
			curr = path.dirname(curr);
		} else {
			break;
		}
	}
}


// This method is called when your extension is deactivated
export function deactivate() { }
