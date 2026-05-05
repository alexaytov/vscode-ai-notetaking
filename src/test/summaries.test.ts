import * as assert from 'assert';
import { extractSummaryFromContent } from '../summaries';

suite('Summaries', () => {
    test('extracts summary from frontmatter', () => {
        const content = '---\ntags: [test]\nsummary: "This is a test note"\n---\n# Hello';
        const summary = extractSummaryFromContent(content);
        assert.strictEqual(summary, 'This is a test note');
    });

    test('returns null when no summary in frontmatter', () => {
        const content = '---\ntags: [test]\n---\n# Hello';
        const summary = extractSummaryFromContent(content);
        assert.strictEqual(summary, null);
    });

    test('returns null when no frontmatter', () => {
        const content = '# Hello\nSome content';
        const summary = extractSummaryFromContent(content);
        assert.strictEqual(summary, null);
    });

    test('handles summary without quotes', () => {
        const content = '---\nsummary: This is unquoted\n---\n';
        const summary = extractSummaryFromContent(content);
        assert.strictEqual(summary, 'This is unquoted');
    });

    test('truncates long summaries to 80 chars', () => {
        const long = 'A'.repeat(100);
        const content = `---\nsummary: "${long}"\n---\n`;
        const summary = extractSummaryFromContent(content);
        assert.strictEqual(summary!.length, 80);
    });
});
