import * as assert from 'assert';
import { extractTagsFromContent } from '../tagCache';

suite('TagCache', () => {
    test('extracts tags from valid frontmatter', () => {
        const content = '---\ntags: [javascript, testing, vscode]\n---\n# Hello';
        const tags = extractTagsFromContent(content);
        assert.deepStrictEqual(tags, ['javascript', 'testing', 'vscode']);
    });

    test('returns empty array when no frontmatter', () => {
        const content = '# Hello\nSome content';
        const tags = extractTagsFromContent(content);
        assert.deepStrictEqual(tags, []);
    });

    test('returns empty array when no tags key', () => {
        const content = '---\ntitle: My Note\n---\n# Hello';
        const tags = extractTagsFromContent(content);
        assert.deepStrictEqual(tags, []);
    });

    test('handles tags with extra spaces', () => {
        const content = '---\ntags: [ foo ,  bar , baz ]\n---\n';
        const tags = extractTagsFromContent(content);
        assert.deepStrictEqual(tags, ['foo', 'bar', 'baz']);
    });
});
