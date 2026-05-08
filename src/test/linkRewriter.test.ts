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
