// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid'; // npm install uuid

import { getAllFolders } from './files';
import { generateTags, generateName, generatePath } from './ai';

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
				const selectedPath = path.join(rootDir, await getPath(rootDir, selectedTags, content));

				const aiName = await generateName(selectedTags);
				const finalName = await vscode.window.showInputBox({
					prompt: 'Suggested note name',
					value: aiName || '',
					placeHolder: 'Note name'
				});

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

	context.subscriptions.push(newNoteDisposable);
}

async function getTags(content: string, savedDoc: vscode.TextDocument): Promise<string[]> {
	const tags = await generateTags(content);

	// Show tags to user as a comma-separated editable list
	let selectedTags: string[] = [];
	if (tags.length > 0) {
		const tagInput = await vscode.window.showInputBox({
			prompt: 'Suggested tags (comma separated, single words, lowercase)',
			value: tags.join(', ')
		});
		if (tagInput) {
			selectedTags = tagInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
		}
	}

	// Add tags to the top of the note as YAML frontmatter if any selected
	if (selectedTags.length > 0) {
		const yaml = `---\ntags: [${selectedTags.join(', ')}]\n---\n`;
		const edit = new vscode.WorkspaceEdit();
		edit.insert(savedDoc.uri, new vscode.Position(0, 0), yaml);
		await vscode.workspace.applyEdit(edit);
		await savedDoc.save();
	}

	return selectedTags;
}

async function getPath(rootDir: string, selectedTags: string[], content: string): Promise<string> {
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
	if (!picked) {return aiPath;}
	if (picked.value === '__other__') {
		const manual = await vscode.window.showInputBox({ prompt: 'Enter relative folder path under workspace', value: aiPath });
		return manual?.trim() || aiPath;
	}
	return picked.value;
}

// This method is called when your extension is deactivated
export function deactivate() { }
