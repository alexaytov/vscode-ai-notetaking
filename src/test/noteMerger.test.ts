import * as assert from 'assert';
import { countWords, stripFrontmatter } from '../noteMerger';

suite('NoteMerger', () => {
    test('countWords counts words in text', () => {
        assert.strictEqual(countWords('hello world foo bar'), 4);
    });

    test('countWords handles empty string', () => {
        assert.strictEqual(countWords(''), 0);
    });

    test('countWords handles whitespace-only', () => {
        assert.strictEqual(countWords('   \n\t  '), 0);
    });

    test('stripFrontmatter removes YAML block', () => {
        const content = '---\ntags: [test]\n---\n# Hello\nContent here';
        assert.strictEqual(stripFrontmatter(content), '# Hello\nContent here');
    });

    test('stripFrontmatter returns content unchanged without frontmatter', () => {
        const content = '# Hello\nContent here';
        assert.strictEqual(stripFrontmatter(content), '# Hello\nContent here');
    });
});
