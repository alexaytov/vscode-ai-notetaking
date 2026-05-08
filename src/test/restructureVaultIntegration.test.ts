import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
    RestructurePlan,
    VaultState,
    buildPathMap,
    applyPlan,
} from '../restructureVault';
import { rewriteAllLinks } from '../linkRewriter';

suite('Restructure end-to-end on temp vault', () => {
    test('rename folder + move note + rewrite links', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aint-e2e-'));
        try {
            // Fixture:
            //   tmp/notes/host.md  — links to [[foo]] and [other](../archive/bar.md)
            //   tmp/notes/foo.md
            //   tmp/archive/bar.md
            await fs.mkdir(path.join(tmp, 'notes'), { recursive: true });
            await fs.mkdir(path.join(tmp, 'archive'), { recursive: true });
            await fs.writeFile(
                path.join(tmp, 'notes', 'host.md'),
                'See [[foo]] and [other](../archive/bar.md).'
            );
            await fs.writeFile(path.join(tmp, 'notes', 'foo.md'), 'Foo body.');
            await fs.writeFile(path.join(tmp, 'archive', 'bar.md'), 'Bar body.');

            const plan: RestructurePlan = {
                operations: [
                    { kind: 'rename', from: 'archive', to: 'old' },
                    { kind: 'move', notePath: 'notes/foo.md', toFolder: 'notes/inner' },
                ],
            };
            const state: VaultState = {
                notes: new Set(['notes/host.md', 'notes/foo.md', 'archive/bar.md']),
                folders: new Set(['notes', 'archive']),
            };

            const pathMap = buildPathMap(plan, state, tmp);
            const apply = await applyPlan(plan, tmp);
            assert.strictEqual(apply.error, undefined);
            assert.strictEqual(apply.folderRenames, 1);
            assert.strictEqual(apply.noteMoves, 1);

            // Filesystem assertions.
            await assertExists(path.join(tmp, 'old', 'bar.md'));
            await assertExists(path.join(tmp, 'notes', 'inner', 'foo.md'));
            await assertNotExists(path.join(tmp, 'archive'));
            await assertNotExists(path.join(tmp, 'notes', 'foo.md'));

            const rewrite = await rewriteAllLinks(tmp, pathMap);
            assert.strictEqual(rewrite.failures.length, 0);

            const newHost = await fs.readFile(path.join(tmp, 'notes', 'host.md'), 'utf8');
            // Wiki-link [[foo]] is preserved (basename unchanged).
            // Markdown link to bar.md must now point to the renamed folder.
            assert.match(newHost, /\[\[foo\]\]/);
            assert.match(newHost, /\[other\]\(\.\.\/old\/bar\.md\)/);
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
});

async function assertExists(p: string): Promise<void> {
    await fs.access(p);
}

async function assertNotExists(p: string): Promise<void> {
    let existed = false;
    try { await fs.access(p); existed = true; } catch { /* good */ }
    if (existed) { throw new Error(`Expected path not to exist: ${p}`); }
}
