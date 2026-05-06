import * as assert from 'assert';
import { rewriteMarkdownLinks, generateSlug, extractTocHeadings, buildBreadcrumb } from '../siteExporter';

suite('SiteExporter', () => {
    test('rewriteMarkdownLinks converts .md to .html paths', () => {
        const md = 'See [my note](./other-note.md) for details.';
        const result = rewriteMarkdownLinks(md);
        assert.strictEqual(result, 'See [my note](../notes/other-note.html) for details.');
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

    test('extractTocHeadings finds h2 and h3', () => {
        const html = '<h2 id="intro">Introduction</h2><p>text</p><h3 id="sub">Sub section</h3>';
        const toc = extractTocHeadings(html);
        assert.strictEqual(toc.length, 2);
        assert.strictEqual(toc[0].id, 'intro');
        assert.strictEqual(toc[0].text, 'Introduction');
        assert.strictEqual(toc[0].level, 2);
        assert.strictEqual(toc[1].level, 3);
    });

    test('buildBreadcrumb for note page', () => {
        const result = buildBreadcrumb('note', 'api-design', '..');
        assert.ok(result.includes('Home'));
        assert.ok(result.includes('Notes'));
        assert.ok(result.includes('api-design'));
    });

    test('buildBreadcrumb for tag page', () => {
        const result = buildBreadcrumb('tag', 'meeting', '..');
        assert.ok(result.includes('Tags'));
        assert.ok(result.includes('meeting'));
    });
});
