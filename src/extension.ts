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

		const guid = uuidv4();
		const fileName = `${formatDateDDMMYYYY(Date.now())}_${guid}.md`;
		const filePath = path.join(draftsDir, fileName);
		const fileUri = vscode.Uri.file(filePath);

		await vscode.workspace.fs.writeFile(fileUri, Buffer.from('', 'utf8'));
		const doc = await vscode.workspace.openTextDocument(fileUri);
		await vscode.window.showTextDocument(doc);

		// Listen for save and move/rename after AI categorization
		const saveListener = vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
			if (savedDoc.uri.fsPath === filePath) {
				saveListener.dispose();

				const content = savedDoc.getText();
				const existingFolders = await getAllFolders(rootDir, 3);

				const metadata = await generateNoteMetadata(content, existingFolders);
				if (!metadata || !metadata.tags || !metadata.name || !metadata.path) {
					vscode.window.showErrorMessage('AI categorization failed, please try again.');
					return;
				}

				const userMetadata = await promptUserForNoteMetadata(metadata, existingFolders, rootDir);
				if (!userMetadata) {
					return;
				}

				const { tags, directory, name } = userMetadata;

				// Make sure the path exists
				if (!fs.existsSync(directory)) {
					fs.mkdirSync(directory, { recursive: true });
				}

				const formattedDate = formatDateDDMMYYYY(Date.now());
				const newFileName = `${name}_${formattedDate}.md`;
				const newFilePath = path.join(directory, newFileName);
				const newFileUri = vscode.Uri.file(newFilePath);

				const yaml = `---\ntags: [${tags.join(', ')}]\n---\n`;
				const edit = new vscode.WorkspaceEdit();
				edit.insert(savedDoc.uri, new vscode.Position(0, 0), yaml);
				await vscode.workspace.applyEdit(edit);
				await savedDoc.save();

				await vscode.workspace.fs.rename(savedDoc.uri, newFileUri, { overwrite: false });
				await vscode.window.showTextDocument(newFileUri);
			}
		});
		context.subscriptions.push(saveListener);
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
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				NotesByTagWebviewProvider.viewType,
				new NotesByTagWebviewProvider(workspaceFolders[0].uri.fsPath)
			)
		);
	}
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
