import * as assert from 'assert';
import { validatePlan, RestructurePlan, VaultState } from '../restructureVault';

const baseState: VaultState = {
    notes: new Set(['notes/a.md', 'notes/b.md', 'archive/c.md']),
    folders: new Set(['notes', 'archive']),
};

suite('validatePlan', () => {
    test('accepts an empty plan', () => {
        const plan: RestructurePlan = { operations: [] };
        const result = validatePlan(plan, baseState);
        assert.strictEqual(result.ok, true);
    });

    test('accepts a valid mix of operations', () => {
        const plan: RestructurePlan = {
            operations: [
                { kind: 'rename', from: 'archive', to: 'old' },
                { kind: 'move', notePath: 'notes/a.md', toFolder: 'notes/sub' },
            ],
        };
        const result = validatePlan(plan, baseState);
        assert.strictEqual(result.ok, true);
    });

    test('rejects rename of a folder that does not exist', () => {
        const plan: RestructurePlan = {
            operations: [{ kind: 'rename', from: 'ghost', to: 'gone' }],
        };
        const result = validatePlan(plan, baseState);
        assert.strictEqual(result.ok, false);
        assert.match(result.error!, /ghost/);
    });

    test('rejects move of a note that does not exist', () => {
        const plan: RestructurePlan = {
            operations: [{ kind: 'move', notePath: 'notes/ghost.md', toFolder: 'archive' }],
        };
        const result = validatePlan(plan, baseState);
        assert.strictEqual(result.ok, false);
        assert.match(result.error!, /ghost\.md/);
    });

    test('rejects two operations producing the same destination', () => {
        const plan: RestructurePlan = {
            operations: [
                { kind: 'rename', from: 'notes', to: 'merged' },
                { kind: 'rename', from: 'archive', to: 'merged' },
            ],
        };
        const result = validatePlan(plan, baseState);
        assert.strictEqual(result.ok, false);
        assert.match(result.error!, /conflicting|duplicate|same destination/i);
    });

    test('rejects renaming a folder into one of its own descendants', () => {
        const stateWithNested: VaultState = {
            notes: new Set(['a/b/c.md']),
            folders: new Set(['a', 'a/b']),
        };
        const plan: RestructurePlan = {
            operations: [{ kind: 'rename', from: 'a', to: 'a/b/c' }],
        };
        const result = validatePlan(plan, stateWithNested);
        assert.strictEqual(result.ok, false);
        assert.match(result.error!, /descendant|cycle|invalid/i);
    });

    test('rejects merge with non-existent source folder', () => {
        const plan: RestructurePlan = {
            operations: [{ kind: 'merge', from: 'ghost', into: 'notes' }],
        };
        const result = validatePlan(plan, baseState);
        assert.strictEqual(result.ok, false);
    });
});
