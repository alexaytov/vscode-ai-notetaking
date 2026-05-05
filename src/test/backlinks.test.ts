import * as assert from 'assert';
import { extractMarkdownLinks } from '../backlinksWebview';

suite('Backlinks', () => {
    test('extracts relative markdown links', () => {
        const content = 'See [my note](./other-note.md) and [ref](../docs/ref.md).';
        const links = extractMarkdownLinks(content);
        assert.deepStrictEqual(links, [
            { text: 'my note', href: './other-note.md' },
            { text: 'ref', href: '../docs/ref.md' },
        ]);
    });

    test('ignores absolute URLs', () => {
        const content = 'See [docs](https://example.com/page.md).';
        const links = extractMarkdownLinks(content);
        assert.deepStrictEqual(links, []);
    });

    test('ignores non-md links', () => {
        const content = 'See [img](./photo.png) and [note](./note.md).';
        const links = extractMarkdownLinks(content);
        assert.deepStrictEqual(links, [
            { text: 'note', href: './note.md' },
        ]);
    });

    test('handles multiple links on same line', () => {
        const content = '[a](a.md) and [b](b.md)';
        const links = extractMarkdownLinks(content);
        assert.deepStrictEqual(links, [
            { text: 'a', href: 'a.md' },
            { text: 'b', href: 'b.md' },
        ]);
    });
});
