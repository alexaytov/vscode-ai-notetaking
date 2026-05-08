import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

// ---------- Types ----------

export type FolderRename = { kind: 'rename'; from: string; to: string };
// Merge: move every note from `from` into `into`, then remove `from` if empty.
export type FolderMerge = { kind: 'merge'; from: string; into: string };
export type NoteMove = { kind: 'move'; notePath: string; toFolder: string };
export type Operation = FolderRename | FolderMerge | NoteMove;

export type RestructurePlan = {
    operations: Operation[];
    rationale?: string;
};

export type VaultState = {
    notes: Set<string>;   // relative paths, forward slashes, e.g. "notes/a.md"
    folders: Set<string>; // relative paths, forward slashes, e.g. "notes/sub"
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

export type NoteEntry = {
    relPath: string;       // POSIX-style, relative to vaultRoot
    title: string;         // basename without .md
    tags: string[];        // from YAML frontmatter
    preview?: string;      // first ~200 chars of body, only when detailed=true
};

// ---------- validatePlan ----------

export function validatePlan(plan: RestructurePlan, state: VaultState): ValidationResult {
    const destinations: string[] = [];

    for (const op of plan.operations) {
        if (op.kind === 'rename') {
            if (!state.folders.has(op.from)) {
                return { ok: false, error: `Folder '${op.from}' does not exist.` };
            }
            if (op.to === op.from) {
                return { ok: false, error: `Rename of '${op.from}' is a no-op.` };
            }
            if (op.to.startsWith(op.from + '/')) {
                return { ok: false, error: `Cannot rename '${op.from}' into its own descendant '${op.to}'.` };
            }
            destinations.push(op.to);
        } else if (op.kind === 'merge') {
            if (!state.folders.has(op.from)) {
                return { ok: false, error: `Merge source folder '${op.from}' does not exist.` };
            }
            if (op.into.startsWith(op.from + '/')) {
                return { ok: false, error: `Cannot merge '${op.from}' into its own descendant '${op.into}'.` };
            }
        } else if (op.kind === 'move') {
            if (!state.notes.has(op.notePath)) {
                return { ok: false, error: `Note '${op.notePath}' does not exist.` };
            }
        }
    }

    // Duplicate destinations check (ignoring merge-into, since multiple merges into the same target are valid).
    const seen = new Set<string>();
    for (const dest of destinations) {
        if (seen.has(dest)) {
            return { ok: false, error: `Multiple operations have the same destination '${dest}' (conflicting renames).` };
        }
        seen.add(dest);
    }

    return { ok: true };
}

// ---------- gatherNotes ----------

export async function gatherNotes(rootDir: string, detailed: boolean): Promise<NoteEntry[]> {
    const out: NoteEntry[] = [];
    async function walk(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.')) { continue; }
            if (entry.name === 'node_modules') { continue; }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                const content = await fs.readFile(full, 'utf8');
                const { tags, body } = parseFrontmatter(content);
                const relPath = path.relative(rootDir, full).split(path.sep).join('/');
                const title = entry.name.replace(/\.md$/, '');
                const note: NoteEntry = { relPath, title, tags };
                if (detailed) {
                    note.preview = body.trim().slice(0, 200);
                }
                out.push(note);
            }
        }
    }
    await walk(rootDir);
    return out;
}

function parseFrontmatter(content: string): { tags: string[]; body: string } {
    const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) { return { tags: [], body: content }; }
    const yaml = m[1];
    const body = m[2];
    const tagsLine = yaml.split('\n').find(l => /^tags\s*:/.test(l));
    if (!tagsLine) { return { tags: [], body }; }
    // Two supported forms: "tags: [a, b]" or "tags: a, b".
    const valuePart = tagsLine.replace(/^tags\s*:\s*/, '').trim();
    const stripped = valuePart.replace(/^\[|\]$/g, '');
    const tags = stripped.split(',').map(t => t.trim()).filter(t => t.length > 0);
    return { tags, body };
}

// ---------- parsePlan ----------

export function parsePlan(response: string): RestructurePlan {
    // Try direct JSON parse first; on failure, look for the first {...} block.
    let raw: any;
    try {
        raw = JSON.parse(response);
    } catch {
        const m = response.match(/\{[\s\S]*\}/);
        if (!m) { throw new Error('AI response contained no JSON object.'); }
        raw = JSON.parse(m[0]);
    }
    if (!raw || !Array.isArray(raw.operations)) {
        throw new Error('AI response missing operations array.');
    }
    const operations: Operation[] = [];
    for (const op of raw.operations) {
        if (!op || typeof op !== 'object') { continue; }
        if (op.kind === 'rename' && typeof op.from === 'string' && typeof op.to === 'string') {
            operations.push({ kind: 'rename', from: op.from, to: op.to });
        } else if (op.kind === 'merge' && typeof op.from === 'string' && typeof op.into === 'string') {
            operations.push({ kind: 'merge', from: op.from, into: op.into });
        } else if (op.kind === 'move' && typeof op.notePath === 'string' && typeof op.toFolder === 'string') {
            operations.push({ kind: 'move', notePath: op.notePath, toFolder: op.toFolder });
        }
    }
    const plan: RestructurePlan = { operations };
    if (typeof raw.rationale === 'string') { plan.rationale = raw.rationale; }
    return plan;
}

// ---------- buildPrompt ----------

export function buildPrompt(notes: NoteEntry[], folders: string[]): string {
    const noteLines = notes.map(n => {
        const tags = n.tags.length > 0 ? `tags=[${n.tags.join(', ')}]` : 'tags=[]';
        const preview = n.preview ? ` preview="${n.preview.replace(/\n/g, ' ').replace(/"/g, "'").slice(0, 200)}"` : '';
        return `- ${n.relPath} ${tags}${preview}`;
    }).join('\n');

    const folderLines = folders.map(f => `- ${f}`).join('\n');

    return `You are reorganizing a markdown notes vault. Refine the existing folder structure conservatively.

Rules:
- Propose changes ONLY when they materially improve organization.
- Do not invent folders for fewer than 2 notes.
- Do not move a note that is already in a sensible folder.
- Output strict JSON matching the schema below — no prose outside the JSON.

Allowed operation kinds:
- {"kind":"rename","from":"<existing folder>","to":"<new folder>"}
- {"kind":"merge","from":"<existing folder>","into":"<existing folder>"}
- {"kind":"move","notePath":"<existing note path>","toFolder":"<destination folder>"}

All paths are relative to the vault root and use forward slashes.

Schema:
{"operations":[...], "rationale":"<one-paragraph explanation>"}

Current folders:
${folderLines}

Current notes:
${noteLines}

Respond with ONLY the JSON object.`;
}

// ---------- Orchestrator stub (filled in later tasks) ----------

export async function restructureVault(rootDir: string): Promise<void> {
    vscode.window.showInformationMessage(`Restructure Vault: not yet implemented (root: ${rootDir})`);
}
