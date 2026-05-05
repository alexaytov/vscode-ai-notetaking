import { chatCompletionWithRetry } from './ai';

export function extractSummaryFromContent(content: string): string | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) { return null; }
    const yaml = match[1];
    const summaryLine = yaml.split('\n').find(line => line.trim().startsWith('summary:'));
    if (!summaryLine) { return null; }
    const valueMatch = summaryLine.match(/^summary:\s*"?([^"]*)"?\s*$/);
    if (!valueMatch || !valueMatch[1]) { return null; }
    const raw = valueMatch[1].trim();
    return raw.length > 80 ? raw.slice(0, 80) : raw;
}

export async function generateSummary(content: string): Promise<string> {
    const prompt = `Summarize this note in one concise sentence (max 15 words). Output only the summary, no quotes or extra formatting.

Note content:
"""${content}"""`;

    const response = await chatCompletionWithRetry(prompt);
    return response.trim().replace(/^["']|["']$/g, '');
}
