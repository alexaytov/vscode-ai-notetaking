import * as assert from 'assert';
import { rewriteMarkdownLinks, generateSlug } from '../siteExporter';

suite('SiteExporter', () => {
    test('rewriteMarkdownLinks converts .md to .html paths', () => {
        const md = 'See [my note](./other-note.md) for details.';
        const result = rewriteMarkdownLinks(md);
        assert.strictEqual(result, 'See [my note](../notes/other-note.html) for details.');
    });

    test('rewriteMarkdownLinks handles nested paths', () => {
        const md = 'See [ref](../docs/ref.md) for details.';
        const result = rewriteMarkdownLinks(md);
        assert.strictEqual(result, 'See [ref](../notes/ref.html) for details.');
    });

    test('rewriteMarkdownLinks ignores absolute URLs', () => {
        const md = 'See [docs](https://example.com/page.md).';
        const result = rewriteMarkdownLinks(md);
        assert.strictEqual(result, 'See [docs](https://example.com/page.md).');
    });

    test('generateSlug creates url-safe slugs', () => {
        assert.strictEqual(generateSlug('Hello World'), 'hello-world');
        assert.strictEqual(generateSlug('C++ Notes!'), 'c-notes');
    });
});
