import * as vscode from 'vscode';

/**
 * Upserts a key-value pair in the YAML frontmatter of a Markdown document.
 * If the frontmatter does not exist, it will be created.
 * If the key exists, it will be updated. Otherwise, it will be added.
 *
 * @param doc The TextDocument to update
 * @param key The YAML key to upsert (string)
 * @param value The value to set (string, or string[] for array)
 */
export async function upsertFrontmatterKey(doc: vscode.TextDocument, key: string, value: string | string[]): Promise<void> {
    await upsertFrontmatterKeys(doc, { [key]: value });
}

/**
 * Upserts multiple key-value pairs in the YAML frontmatter of a Markdown document.
 * Accepts an object where each key is a YAML key and each value is a string or string[].
 * Only saves the document once after all changes are applied.
 *
 * @param doc The TextDocument to update
 * @param keyValues An object with key-value pairs to upsert
 */
export async function upsertFrontmatterKeys(doc: vscode.TextDocument, keyValues: Record<string, string | string[]>): Promise<void> {
    const content = doc.getText();
    // Improved regex: match frontmatter even if empty (---\n--- or ---\n...\n---)
    const yamlRegex = /^---\n([\s\S]*?)?---\n?/;
    const existingYamlMatch = content.match(yamlRegex);
    let newContent: string;

    // Prepare new key lines
    const newKeyLines: Record<string, string> = {};
    for (const [key, value] of Object.entries(keyValues)) {
        newKeyLines[key] = Array.isArray(value) ? `${key}: [${value.join(', ')}]` : `${key}: ${value}`;
    }

    if (existingYamlMatch) {
        // Extract YAML block and the rest of the content
        const yamlBlock = existingYamlMatch[0];
        let yamlLines = yamlBlock.split('\n');
        // Remove empty lines (handles empty frontmatter like '---\n---')
        yamlLines = yamlLines.filter(line => line.trim() !== '' && line.trim() !== '---');
        // Track which keys have been updated
        const updatedKeys = new Set<string>();
        yamlLines = yamlLines.map(line => {
            const trimmed = line.trim();
            const keyMatch = trimmed.match(/^([a-zA-Z0-9_-]+):/);
            if (keyMatch && newKeyLines[keyMatch[1]]) {
                updatedKeys.add(keyMatch[1]);
                return newKeyLines[keyMatch[1]];
            }
            return line;
        });
        // Add any new keys that weren't present
        for (const [key, line] of Object.entries(newKeyLines)) {
            if (!updatedKeys.has(key)) {
                yamlLines.push(line);
            }
        }
        // If the original YAML was empty, avoid duplicating frontmatter
        const newYaml = yamlLines.length > 0
            ? `---\n${yamlLines.join('\n')}\n---\n`
            : `---\n${Object.values(newKeyLines).join('\n')}\n---\n`;
        newContent = newYaml + content.slice(existingYamlMatch[0].length);
    } else {
        // No YAML frontmatter, just add it
        const newYaml = `---\n${Object.values(newKeyLines).join('\n')}\n---\n`;
        newContent = newYaml + content;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
        doc.uri,
        new vscode.Range(0, 0, doc.lineCount, 0),
        newContent
    );
    await vscode.workspace.applyEdit(edit);
    await doc.save();
}
