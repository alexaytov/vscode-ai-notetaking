// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid'; // npm install uuid

import { getAllFolders } from './files';
import { generateTags, generateName, generatePath } from './ai';
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

				const selectedTags = await getTags(content, savedDoc);
				if (!selectedTags) {
					vscode.window.showErrorMessage('No tags selected, note not saved.');
					return;
				}
				if (selectedTags.length > 0) {
					const yaml = `---\ntags: [${selectedTags.join(', ')}]\n---\n`;
					const edit = new vscode.WorkspaceEdit();
					edit.insert(savedDoc.uri, new vscode.Position(0, 0), yaml);
					await vscode.workspace.applyEdit(edit);
					await savedDoc.save();
				}


				const selectedPath = await getPath(rootDir, selectedTags, content);
				if (!selectedPath) {
					vscode.window.showErrorMessage('No path selected, note not saved.');
					return;
				}

				const aiName = await generateName(selectedTags);
				const finalName = await vscode.window.showInputBox({
					prompt: 'Suggested note name',
					value: aiName || '',
					placeHolder: 'Note name'
				});
				if (!finalName) {
					vscode.window.showErrorMessage('No name provided, note not saved.');
					return;
				}

				// Make sure the path exists
				if (!fs.existsSync(selectedPath)) {
					fs.mkdirSync(selectedPath, { recursive: true });
				}

				const formattedDate = formatDateDDMMYYYY(Date.now());
				const newFileName = `${finalName}_${formattedDate}.md`;
				const newFilePath = path.join(selectedPath, newFileName);
				const newFileUri = vscode.Uri.file(newFilePath);

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

		const newTags = await getTags(cleanedContent, doc);
		if (!newTags) {
			vscode.window.showErrorMessage('No tags selected, note not reclassified.');
			return;
		}

		const newDirectory = await getPath(rootDir, newTags, cleanedContent);
		if (!newDirectory) {
			vscode.window.showErrorMessage('No path selected, note not reclassified.');
			return;
		}

		const newName = await generateName(newTags);
		const finalName = await vscode.window.showInputBox({
			prompt: 'Suggested note name',
			value: newName || ''
		});
		if (!finalName) {
			vscode.window.showErrorMessage('No name provided, note not reclassified.');
			return;
		}

		// Update tags
		await upsertFrontmatterKey(doc, 'tags', newTags);
				
		// Update directory and name

		// Make sure the new directory exists
		if (!fs.existsSync(newDirectory)) {
			fs.mkdirSync(newDirectory, { recursive: true });
		}

		// Rename the file with the new name and current date
		const formattedDate = formatDateDDMMYYYY(Date.now());
		const newFileName = `${finalName}_${formattedDate}.md`;
		const newFilePath = path.join(newDirectory, newFileName);
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

async function getTags(content: string, savedDoc: vscode.TextDocument): Promise<string[] | undefined> {
	const tags = await generateTags(content);

	// Show tags to user as a comma-separated editable list
	let selectedTags: string[] = [];
	const tagInput = await vscode.window.showInputBox({
		prompt: 'Suggested tags (comma separated, single words, lowercase)',
		value: tags.join(', ')
	});
	if (!tagInput) {
		return;
	}

	selectedTags = tagInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
	return selectedTags;
}

async function getPath(rootDir: string, selectedTags: string[], content: string): Promise<string | undefined> {
	const existingFolders = await getAllFolders(rootDir, 3);
	const aiPath = await generatePath(selectedTags, content, existingFolders);

	let options = [];
	if (aiPath && existingFolders.includes(aiPath)) {
		options.push({ label: `Use existing folder: ${aiPath}`, value: aiPath });
	} else if (aiPath) {
		options.push({ label: `Create new folder: ${aiPath}`, value: aiPath });
	}
	options.push({ label: 'Other (specify manually)', value: '__other__' });
	const picked = await vscode.window.showQuickPick(options, { placeHolder: 'Select a folder to categorize this note' });
	if (!picked) {
		return;
	}

	if (picked.value === '__other__') {
		const manual = await vscode.window.showInputBox({ prompt: 'Enter relative folder path under workspace', value: aiPath });
		if (!manual) {
			return;
		}

		return path.join(rootDir, manual.trim());
	}
	return path.join(rootDir, picked.value);
}

// This method is called when your extension is deactivated
export function deactivate() { }
