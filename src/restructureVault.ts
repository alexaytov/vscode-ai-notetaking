import * as vscode from 'vscode';

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

// ---------- Orchestrator stub (filled in later tasks) ----------

export async function restructureVault(rootDir: string): Promise<void> {
    vscode.window.showInformationMessage(`Restructure Vault: not yet implemented (root: ${rootDir})`);
}
