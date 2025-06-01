import * as vscode from 'vscode';

export async function aiCoreChatCompletion(prompt: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('ai-notes');
    const aiCoreServiceKey = config.get<string>('aiCoreServiceKey');
    const model = config.get<string>('aiModel');

    process.env.AICORE_SERVICE_KEY = aiCoreServiceKey;

    const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/foundation-models');
    const client = new AzureOpenAiChatClient({
        modelName: model || 'gpt-4o',
    });

    const response = await client.run({
        messages: [
            {
                role: 'user',
                content: prompt
            }
        ]
    });

    const content = response.getContent();

    if (!content) {
        throw new Error('AI response is empty or undefined.');
    }

    return content;
}