import * as assert from 'assert';
import { parseSearchResults, buildNoteEntry } from '../semanticSearch';

suite('SemanticSearch', () => {
    test('parseSearchResults extracts indices from JSON array', () => {
        const response = '[3, 1, 7, 2]';
        const indices = parseSearchResults(response);
        assert.deepStrictEqual(indices, [3, 1, 7, 2]);
    });

    test('parseSearchResults handles messy AI output', () => {
        const response = 'Here are the results: [5, 2, 8]\nHope that helps!';
        const indices = parseSearchResults(response);
        assert.deepStrictEqual(indices, [5, 2, 8]);
    });

    test('parseSearchResults returns empty on invalid output', () => {
        const response = 'I cannot determine relevance.';
        const indices = parseSearchResults(response);
        assert.deepStrictEqual(indices, []);
    });

    test('buildNoteEntry uses summary when available', () => {
        const entry = buildNoteEntry('/path/to/note.md', 'This is the summary');
        assert.strictEqual(entry, 'note.md — This is the summary');
    });

    test('buildNoteEntry uses content snippet when no summary', () => {
        const content = 'A'.repeat(150);
        const entry = buildNoteEntry('/path/to/note.md', null, content);
        assert.strictEqual(entry.length, 'note.md — '.length + 100);
    });
});
