import * as fs from 'fs/promises';
import * as path from 'path';

export const getAllFolders = async (root: string, depth = 3, prefix = ''): Promise<string[]> => {
    if (depth === 0) { return []; }
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