import * as assert from 'assert';
import { rewriteLinks } from '../linkRewriter';

// All paths are POSIX-style (forward slashes) for these tests.
// rewriteLinks normalizes its inputs so callers can pass either separator.

suite('linkRewriter wiki-links', () => {
    test('rewrites a simple wiki-link when target moved', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = 'See [[foo]] for details.';
        const result = rewriteLinks(content, '/v/notes/host.md', '/v', pathMap);
        // Basename unchanged (foo.md → foo.md), so the wiki text stays the same.
        assert.strictEqual(result, 'See [[foo]] for details.');
    });

    test('preserves alias when wiki-link has one', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = 'See [[foo|the foo doc]].';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, 'See [[foo|the foo doc]].');
    });

    test('leaves wiki-link unchanged when target not in pathMap', () => {
        const pathMap = new Map<string, string>();
        const content = 'See [[bar]] over there.';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, 'See [[bar]] over there.');
    });

    test('does not rewrite wiki-links inside fenced code blocks', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = '```\n[[foo]]\n```\nReal: [[foo]]';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        // Both links target the same file with same basename, so visually unchanged,
        // but the fenced one must not be touched even structurally — assert exact equality.
        assert.strictEqual(result, '```\n[[foo]]\n```\nReal: [[foo]]');
    });

    test('does not rewrite wiki-links inside inline code', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = 'Use `[[foo]]` syntax. Then [[foo]] for real.';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, 'Use `[[foo]]` syntax. Then [[foo]] for real.');
    });

    test('returns content unchanged for empty pathMap', () => {
        const pathMap = new Map<string, string>();
        const content = 'Plenty of [[wiki]] [[links]] here.';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, content);
    });
});

suite('linkRewriter markdown links', () => {
    test('rewrites relative markdown link when target moved', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        // Host note did not move; it sits at /v/host.md.
        // Old link points to /v/old/foo.md — must now point to /v/new/foo.md.
        const content = 'See [the foo](old/foo.md) for details.';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, 'See [the foo](new/foo.md) for details.');
    });

    test('preserves anchor fragment when rewriting markdown link', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = 'See [the foo](old/foo.md#section-2).';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, 'See [the foo](new/foo.md#section-2).');
    });

    test('recomputes relative path when host note also moved', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
            ['/v/notes/host.md', '/v/archive/host.md'],
        ]);
        const content = 'See [foo](../old/foo.md).';
        // Host moves /v/notes/host.md → /v/archive/host.md.
        // Target moves /v/old/foo.md → /v/new/foo.md.
        // New relative path from /v/archive/host.md → /v/new/foo.md is "../new/foo.md".
        const result = rewriteLinks(content, '/v/notes/host.md', '/v', pathMap);
        assert.strictEqual(result, 'See [foo](../new/foo.md).');
    });

    test('leaves absolute URLs unchanged', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = 'See [external](https://example.com/page).';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, content);
    });

    test('rewrites image links the same way', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/img.png', '/v/new/img.png'],
        ]);
        const content = '![alt](old/img.png)';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, '![alt](new/img.png)');
    });

    test('does not rewrite markdown links inside fenced code', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = '```\n[x](old/foo.md)\n```';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, content);
    });

    test('leaves link to file not in pathMap unchanged', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/foo.md', '/v/new/foo.md'],
        ]);
        const content = 'See [bar](other/bar.md).';
        const result = rewriteLinks(content, '/v/host.md', '/v', pathMap);
        assert.strictEqual(result, content);
    });

    test('rewrites self-referencing markdown link when note moves', () => {
        const pathMap = new Map<string, string>([
            ['/v/old/self.md', '/v/new/self.md'],
        ]);
        const content = 'See [myself](../old/self.md).';
        // Host is /v/old/self.md, which is itself moving to /v/new/self.md.
        // The link target is also /v/old/self.md → /v/new/self.md (same path).
        // From the new host dir /v/new, the link to /v/new/self.md is just "self.md".
        const result = rewriteLinks(content, '/v/old/self.md', '/v', pathMap);
        assert.strictEqual(result, 'See [myself](self.md).');
    });
});
