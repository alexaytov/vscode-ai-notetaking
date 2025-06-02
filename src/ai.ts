import * as vscode from 'vscode';

import { aiCoreChatCompletion } from './ai-core';

export interface NoteMetadata {
    tags: string[];
    name: string;
    path: string;
}

/**
 * Generates tags, name, and path in a single AI call.
 */
export async function generateNoteMetadata(content: string, existingFolders: string[]): Promise<NoteMetadata> {
    const prompt = `
You are an AI assistant for note-taking.
Given the following note content, do the following:
1. Extract up to 5 relevant tags (single words, comma-separated, lowercase, no spaces).
2. Suggest a concise, descriptive name for the note (lowercase, dash-separated, no special characters or spaces).
3. Suggest the most appropriate folder path for this note from the following list: [${existingFolders.join(', ')}]. If none are suitable, propose a new folder path (up to 3 levels deep, using lowercase letters and dashes).

Respond in JSON format:
{
  "tags": ["tag1", "tag2", ...],
  "name": "suggested-note-name",
  "path": "suggested/folder/path"
}

Note content:
"""${content}"""
    `;
    const response = await chatCompletionWithRetry(prompt);

    try {
        // Try to parse the response as JSON
        const json = JSON.parse(response);
        if (
            Array.isArray(json.tags) &&
            typeof json.name === 'string' &&
            typeof json.path === 'string'
        ) {
            return {
                tags: json.tags.map((t: string) => t.trim()).filter((t: string) => t.length > 0),
                name: json.name.trim(),
                path: json.path.trim(),
            };
        }
    } catch (e) {
        // fallback: try to extract manually if not valid JSON
        const tagsMatch = response.match(/"tags"\s*:\s*\[([^\]]+)\]/);
        const nameMatch = response.match(/"name"\s*:\s*"([^"]+)"/);
        const pathMatch = response.match(/"path"\s*:\s*"([^"]+)"/);
        return {
            tags: tagsMatch ? tagsMatch[1].split(',').map((t: string) => t.replace(/["']/g, '').trim()) : [],
            name: nameMatch ? nameMatch[1] : '',
            path: pathMatch ? pathMatch[1] : '',
        };
    }
    return { tags: [], name: '', path: '' };
}

async function aiCompletion(prompt: string | undefined): Promise<string> {
    const config = vscode.workspace.getConfiguration('ai-notes');
    const llmProvider = config.get<string>('llmProvider');
    const model = config.get<string>('aiModel');

    if (llmProvider === 'sap-ai-core') {
        return aiCoreChatCompletion(prompt);
    } else if (llmProvider === 'vscode-lm-api') {
        return vsCodeLMAPIChatCompletion(prompt, model);
    } else {
        throw new Error('Unsupported LLM provider: ' + llmProvider);
    }
}

async function vsCodeLMAPIChatCompletion(prompt: string, aiModel: string): Promise<string> {
    // @ts-ignore - VS Code LM API is proposed and may not be typed
    if (vscode.lm && vscode.lm.selectChatModels) {
        const [model] = await vscode.lm.selectChatModels({
            vendor: 'copilot',
            family: aiModel,
        });
        if (!model) {
            throw new Error('No suitable AI model found for chat completion.');
        }

        try {
            // @ts-ignore
            const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)]);
            let completeResponse = '';
            for await (const fragment of response.text) {
                completeResponse += fragment;
            }
            return completeResponse;
        } catch (err: any) {
            throw new Error('AI chat completion failed: ' + err.message);
        }
    } else {
        throw new Error('VS Code LM API not available.');
    }
}

async function chatCompletionWithRetry(prompt: string, retries = 3): Promise<string> {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await aiCompletion(prompt);
        } catch (err: any) {
            console.warn(`Attempt ${attempt + 1} failed: ${err.message}`);
        }
    }

    throw new Error('All attempts to generate response failed.');
}

export async function generateName(tags: string[]): Promise<string> {
    // Compose a prompt for name generation
    const prompt = `
You are an AI assistant for note-taking.
Given the following tags, generate a concise and descriptive name for a note.
The name should be lowercase, single line, dash-separated, and should not include any special characters or spaces.
Output the name as a single line of text.

Tags:
${tags.join(', ')}
    `;
    return chatCompletionWithRetry(prompt);
}

/**
 * Uses the VS Code LM API to generate tags for a note based on its content.
 * @param content The note content to analyze.
 * @returns An array of tag strings, or an empty array if LM API is unavailable.
 */
export async function generateTags(content: string): Promise<string[]> {
    // Compose a prompt for tag extraction
    const prompt = `
You are an AI assistant for note-taking.
Given the following note content, extract up to 5 relevant tags (single words, comma-separated, lowercase, no spaces).
Respond with only the tags.

Note content:
${content}
    `;

    // @ts-ignore - VS Code LM API is proposed and may not be typed
    if (vscode.lm && vscode.lm.selectChatModels) {
        try {
            const response = await chatCompletionWithRetry(prompt);
            return response.split(',').map((tag: string) => tag.trim()).filter((tag: string | any[]) => tag.length > 0);
        } catch (err) {
            vscode.window.showWarningMessage('AI tag generation failed.');
        }
    } else {
        vscode.window.showWarningMessage('VS Code LM API not available.');
    }

    return [];
}

export async function generatePath(tags: string[], content: string, existingFolders: string[]): Promise<string> {
    const aiPrompt = `Given the following tags: ${JSON.stringify(tags)}, note content: """${content.substring(0, 500)}""", and these existing folders: [${existingFolders.join(', ')}]. Choose the most appropriate folder from the list for categorizing this note. If none are suitable, propose a new folder path (up to 3 levels deep, using lowercase letters and dashes). Output only the selected path.`;

    const response = await chatCompletionWithRetry(aiPrompt);

    return response.split(/[\n/\\]/).map(seg => seg.replace(/_/g, '-').trim()).filter(Boolean).slice(0, 3).join('/');
}