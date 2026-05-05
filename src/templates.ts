import * as path from 'path';
import * as fsp from 'fs/promises';

export interface TemplateInfo {
    name: string;
    filePath: string;
    source: 'built-in' | 'workspace';
}

function formatDateDDMMYYYY(): string {
    const date = new Date();
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}

export function expandTemplateVariables(content: string, title?: string): string {
    let result = content;
    result = result.replace(/\{\{date\}\}/g, formatDateDDMMYYYY());
    result = result.replace(/\{\{title\}\}/g, title || 'Untitled');
    return result;
}

export async function discoverTemplates(
    extensionPath: string,
    workspaceRoot: string
): Promise<TemplateInfo[]> {
    const templates: TemplateInfo[] = [];

    const builtInDir = path.join(extensionPath, 'resources', 'templates');
    try {
        const entries = await fsp.readdir(builtInDir);
        for (const entry of entries) {
            if (entry.endsWith('.md')) {
                templates.push({
                    name: path.basename(entry, '.md'),
                    filePath: path.join(builtInDir, entry),
                    source: 'built-in',
                });
            }
        }
    } catch {}

    const workspaceTemplateDir = path.join(workspaceRoot, '.templates');
    try {
        const entries = await fsp.readdir(workspaceTemplateDir);
        for (const entry of entries) {
            if (entry.endsWith('.md')) {
                templates.push({
                    name: path.basename(entry, '.md'),
                    filePath: path.join(workspaceTemplateDir, entry),
                    source: 'workspace',
                });
            }
        }
    } catch {}

    return templates;
}

export async function loadTemplateContent(templatePath: string): Promise<string> {
    return fsp.readFile(templatePath, 'utf8');
}
