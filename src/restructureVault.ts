import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { chatCompletionWithRetry } from './ai';
import { getAllFolders } from './files';
import { rewriteAllLinks } from './linkRewriter';

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

// ---------- buildPathMap ----------

/**
 * Compute the absolute oldPath → newPath map for every note affected by `plan`.
 * Pure: no I/O. Path strings use forward slashes.
 */
export function buildPathMap(plan: RestructurePlan, state: VaultState, vaultRoot: string): Map<string, string> {
    const map = new Map<string, string>();
    const root = vaultRoot.replace(/\/+$/, '');

    // Renames: every note under `from/` moves to `to/<same-suffix>`.
    for (const op of plan.operations) {
        if (op.kind !== 'rename') { continue; }
        const fromPrefix = op.from + '/';
        for (const noteRel of state.notes) {
            if (noteRel === op.from + '/' || noteRel.startsWith(fromPrefix)) {
                const suffix = noteRel.slice(op.from.length);
                map.set(`${root}/${noteRel}`, `${root}/${op.to}${suffix}`);
            }
        }
    }

    // Merges: every note directly under `from/` (or any depth) moves to `into/<basename-or-subpath>`.
    for (const op of plan.operations) {
        if (op.kind !== 'merge') { continue; }
        const fromPrefix = op.from + '/';
        for (const noteRel of state.notes) {
            if (noteRel.startsWith(fromPrefix)) {
                const suffix = noteRel.slice(op.from.length); // "/sub/x.md" or "/x.md"
                map.set(`${root}/${noteRel}`, `${root}/${op.into}${suffix}`);
            }
        }
    }

    // Note moves: explicit single-note relocation, overrides any prior mapping for that note.
    for (const op of plan.operations) {
        if (op.kind !== 'move') { continue; }
        const basename = op.notePath.split('/').pop()!;
        map.set(`${root}/${op.notePath}`, `${root}/${op.toFolder}/${basename}`);
    }

    return map;
}

// ---------- applyPlan ----------

/**
 * Apply the plan to the filesystem. Caller must have validated the plan first.
 * Order: folder renames → folder merges → note moves. Stops on first error.
 * Returns counts and any error encountered.
 */
export async function applyPlan(plan: RestructurePlan, vaultRoot: string): Promise<{
    folderRenames: number;
    folderMerges: number;
    noteMoves: number;
    error?: string;
}> {
    let folderRenames = 0;
    let folderMerges = 0;
    let noteMoves = 0;

    try {
        // Phase B(a): folder renames.
        for (const op of plan.operations) {
            if (op.kind !== 'rename') { continue; }
            const fromAbs = path.join(vaultRoot, op.from);
            const toAbs = path.join(vaultRoot, op.to);
            await fs.mkdir(path.dirname(toAbs), { recursive: true });
            await fs.rename(fromAbs, toAbs);
            folderRenames++;
        }

        // Phase B(b): folder merges.
        for (const op of plan.operations) {
            if (op.kind !== 'merge') { continue; }
            const fromAbs = path.join(vaultRoot, op.from);
            const intoAbs = path.join(vaultRoot, op.into);
            await fs.mkdir(intoAbs, { recursive: true });
            await moveDirectoryContents(fromAbs, intoAbs);
            // Remove source folder if it ends up empty.
            try { await fs.rmdir(fromAbs); } catch { /* not empty — leave it */ }
            folderMerges++;
        }

        // Phase B(c): note moves.
        for (const op of plan.operations) {
            if (op.kind !== 'move') { continue; }
            const fromAbs = path.join(vaultRoot, op.notePath);
            const basename = path.basename(op.notePath);
            const toAbs = path.join(vaultRoot, op.toFolder, basename);
            await fs.mkdir(path.dirname(toAbs), { recursive: true });
            await fs.rename(fromAbs, toAbs);
            noteMoves++;
        }
    } catch (err: any) {
        return { folderRenames, folderMerges, noteMoves, error: err.message ?? String(err) };
    }

    return { folderRenames, folderMerges, noteMoves };
}

async function moveDirectoryContents(srcDir: string, destDir: string): Promise<void> {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        await fs.rename(srcPath, destPath);
    }
}

// ---------- Orchestrator ----------

const OUTPUT_CHANNEL_NAME = 'AI Notes: Restructure';
let outputChannel: vscode.OutputChannel | undefined;

function log(message: string): void {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    }
    outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

export async function restructureVault(rootDir: string): Promise<void> {
    // 1. Strategy QuickPick.
    const strategy = await vscode.window.showQuickPick(
        [
            { label: 'Compact', description: 'Titles + tags only — fast' },
            { label: 'Detailed', description: 'Titles + tags + first 200 chars of body — slower, better quality' },
        ],
        { placeHolder: 'Choose context strategy' }
    );
    if (!strategy) { return; }
    const detailed = strategy.label === 'Detailed';

    // 2. Gather notes and folders.
    const notes = await gatherNotes(rootDir, detailed);
    if (notes.length === 0) {
        vscode.window.showInformationMessage('No notes found.');
        return;
    }
    if (notes.length === 1) {
        vscode.window.showInformationMessage('Need at least 2 notes to restructure.');
        return;
    }
    const folders = await getAllFolders(rootDir, 5);
    log(`Gathered ${notes.length} notes, ${folders.length} folders.`);

    // 3. Build prompt and call LLM.
    const prompt = buildPrompt(notes, folders);
    log(`Prompt size: ${prompt.length} chars (truncated): ${prompt.slice(0, 1000)}`);

    let response: string;
    try {
        response = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Restructure Vault: asking AI...' },
            () => chatCompletionWithRetry(prompt)
        );
    } catch (err: any) {
        vscode.window.showErrorMessage(`AI request failed: ${err.message}`);
        return;
    }

    // 4. Parse and validate.
    let plan: RestructurePlan;
    try {
        plan = parsePlan(response);
    } catch (err: any) {
        log(`Parse error: ${err.message}\nResponse: ${response}`);
        vscode.window.showErrorMessage(err.message);
        return;
    }
    log(`Parsed plan: ${JSON.stringify(plan)}`);

    if (plan.operations.length === 0) {
        vscode.window.showInformationMessage('Vault structure looks fine — no changes proposed.');
        return;
    }

    const state = buildVaultState(notes, folders);
    const validation = validatePlan(plan, state);
    if (!validation.ok) {
        log(`Validation failed: ${validation.error}`);
        vscode.window.showErrorMessage(`AI proposed an invalid plan: ${validation.error}`);
        return;
    }

    // 5. Show summary, ask for confirmation.
    const summary = summarizePlan(plan);
    const choice = await vscode.window.showInformationMessage(summary, { modal: true }, 'Apply', 'Cancel');
    if (choice !== 'Apply') { return; }

    // 6. Apply: build pathMap, do filesystem moves, then rewrite links.
    const pathMap = buildPathMap(plan, state, rootDir);
    log(`Built pathMap with ${pathMap.size} entries.`);

    const applyResult = await applyPlan(plan, rootDir);
    if (applyResult.error) {
        log(`Apply error after ${applyResult.folderRenames + applyResult.folderMerges + applyResult.noteMoves} ops: ${applyResult.error}`);
        vscode.window.showErrorMessage(
            `Restructure partially applied (${applyResult.folderRenames} renames, ${applyResult.folderMerges} merges, ${applyResult.noteMoves} moves) before error: ${applyResult.error}. Links not yet rewritten — please review the vault.`
        );
        return;
    }

    const rewriteResult = await rewriteAllLinks(rootDir, pathMap);
    log(`Link rewrite: ${rewriteResult.rewritten} notes updated, ${rewriteResult.failures.length} failures.`);
    for (const f of rewriteResult.failures) { log(`  failure: ${f.path} — ${f.error}`); }

    // 7. Final toast.
    const failurePart = rewriteResult.failures.length > 0
        ? `, ${rewriteResult.failures.length} link-rewrite failures (see Output panel)`
        : '';
    vscode.window.showInformationMessage(
        `Restructure done: ${applyResult.folderRenames} folder renames, ${applyResult.folderMerges} folder merges, ${applyResult.noteMoves} notes moved, ${rewriteResult.rewritten} notes had links rewritten${failurePart}.`
    );
}

function buildVaultState(notes: NoteEntry[], folders: string[]): VaultState {
    return {
        notes: new Set(notes.map(n => n.relPath)),
        folders: new Set(folders.map(f => f.split(path.sep).join('/'))),
    };
}

function summarizePlan(plan: RestructurePlan): string {
    let renames = 0, merges = 0, moves = 0;
    for (const op of plan.operations) {
        if (op.kind === 'rename') { renames++; }
        else if (op.kind === 'merge') { merges++; }
        else if (op.kind === 'move') { moves++; }
    }
    const lines = [
        'Proposed changes:',
        `• ${renames} folder rename${renames === 1 ? '' : 's'}`,
        `• ${merges} folder merge${merges === 1 ? '' : 's'}`,
        `• ${moves} note${moves === 1 ? '' : 's'} will move`,
    ];
    if (plan.rationale) {
        lines.push('', `Rationale: ${plan.rationale}`);
    }
    lines.push('', 'Apply this plan?');
    return lines.join('\n');
}
