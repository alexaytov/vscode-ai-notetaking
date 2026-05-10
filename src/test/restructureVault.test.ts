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

    test('rejects rename whose target folder already exists', () => {
        const stateWithCollision: VaultState = {
            notes: new Set(['a/x.md', 'b/y.md']),
            folders: new Set(['a', 'b']),
        };
        const plan: RestructurePlan = {
            operations: [{ kind: 'rename', from: 'a', to: 'b' }],
        };
        const result = validatePlan(plan, stateWithCollision);
        assert.strictEqual(result.ok, false);
        assert.match(result.error!, /already exists|merge/i);
    });
});

import { gatherNotes, NoteEntry } from '../restructureVault';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

suite('gatherNotes', () => {
    test('reads markdown files and parses tags from frontmatter', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aint-'));
        try {
            await fs.mkdir(path.join(tmp, 'notes'), { recursive: true });
            await fs.writeFile(
                path.join(tmp, 'notes', 'a.md'),
                '---\ntags: [foo, bar]\n---\nBody A'
            );
            await fs.writeFile(
                path.join(tmp, 'notes', 'b.md'),
                'No frontmatter, just body B.'
            );
            const notes = await gatherNotes(tmp, false);
            // Sort for deterministic comparison.
            notes.sort((x, y) => x.relPath.localeCompare(y.relPath));
            assert.strictEqual(notes.length, 2);
            assert.strictEqual(notes[0].relPath, 'notes/a.md');
            assert.deepStrictEqual(notes[0].tags, ['foo', 'bar']);
            assert.strictEqual(notes[0].title, 'a');
            assert.strictEqual(notes[1].relPath, 'notes/b.md');
            assert.deepStrictEqual(notes[1].tags, []);
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });

    test('includes preview when detailed=true', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aint-'));
        try {
            await fs.writeFile(
                path.join(tmp, 'a.md'),
                '---\ntags: [t]\n---\nThis is the body content for preview testing.'
            );
            const notes = await gatherNotes(tmp, true);
            assert.strictEqual(notes.length, 1);
            assert.ok(notes[0].preview);
            assert.ok(notes[0].preview!.startsWith('This is the body'));
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });

    test('skips dotfiles and node_modules', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aint-'));
        try {
            await fs.mkdir(path.join(tmp, '.hidden'), { recursive: true });
            await fs.mkdir(path.join(tmp, 'node_modules'), { recursive: true });
            await fs.writeFile(path.join(tmp, '.hidden', 'a.md'), 'body');
            await fs.writeFile(path.join(tmp, 'node_modules', 'b.md'), 'body');
            await fs.writeFile(path.join(tmp, 'real.md'), 'body');
            const notes = await gatherNotes(tmp, false);
            assert.strictEqual(notes.length, 1);
            assert.strictEqual(notes[0].relPath, 'real.md');
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
});

import { parsePlan } from '../restructureVault';

suite('parsePlan', () => {
    test('parses well-formed JSON response', () => {
        const response = JSON.stringify({
            operations: [
                { kind: 'rename', from: 'a', to: 'b' },
                { kind: 'move', notePath: 'a/x.md', toFolder: 'b' },
            ],
            rationale: 'tighter naming',
        });
        const plan = parsePlan(response);
        assert.strictEqual(plan.operations.length, 2);
        assert.strictEqual(plan.rationale, 'tighter naming');
    });

    test('extracts JSON from a response with surrounding text', () => {
        const response = 'Here is the plan:\n```json\n{"operations":[]}\n```\nThanks.';
        const plan = parsePlan(response);
        assert.strictEqual(plan.operations.length, 0);
    });

    test('throws on response with no JSON object', () => {
        assert.throws(() => parsePlan('just text, no json'));
    });

    test('throws on JSON missing operations array', () => {
        assert.throws(() => parsePlan('{"foo":"bar"}'));
    });

    test('filters operations with unknown kind', () => {
        const response = JSON.stringify({
            operations: [
                { kind: 'rename', from: 'a', to: 'b' },
                { kind: 'delete', path: 'a/x.md' },
            ],
        });
        const plan = parsePlan(response);
        assert.strictEqual(plan.operations.length, 1);
        assert.strictEqual(plan.operations[0].kind, 'rename');
    });
});

import { buildPathMap } from '../restructureVault';

suite('buildPathMap', () => {
    test('maps a renamed folder\'s notes to new paths', () => {
        const plan: RestructurePlan = {
            operations: [{ kind: 'rename', from: 'old', to: 'new' }],
        };
        const state: VaultState = {
            notes: new Set(['old/a.md', 'old/sub/b.md', 'other/c.md']),
            folders: new Set(['old', 'old/sub', 'other']),
        };
        const map = buildPathMap(plan, state, '/v');
        assert.strictEqual(map.get('/v/old/a.md'), '/v/new/a.md');
        assert.strictEqual(map.get('/v/old/sub/b.md'), '/v/new/sub/b.md');
        assert.strictEqual(map.has('/v/other/c.md'), false);
    });

    test('maps a moved note', () => {
        const plan: RestructurePlan = {
            operations: [{ kind: 'move', notePath: 'old/a.md', toFolder: 'new' }],
        };
        const state: VaultState = {
            notes: new Set(['old/a.md']),
            folders: new Set(['old', 'new']),
        };
        const map = buildPathMap(plan, state, '/v');
        assert.strictEqual(map.get('/v/old/a.md'), '/v/new/a.md');
    });

    test('maps a folder merge', () => {
        const plan: RestructurePlan = {
            operations: [{ kind: 'merge', from: 'a', into: 'b' }],
        };
        const state: VaultState = {
            notes: new Set(['a/x.md', 'a/y.md', 'b/z.md']),
            folders: new Set(['a', 'b']),
        };
        const map = buildPathMap(plan, state, '/v');
        assert.strictEqual(map.get('/v/a/x.md'), '/v/b/x.md');
        assert.strictEqual(map.get('/v/a/y.md'), '/v/b/y.md');
        assert.strictEqual(map.has('/v/b/z.md'), false);
    });
});
