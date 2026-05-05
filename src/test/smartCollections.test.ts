import * as assert from 'assert';
import { matchesCollection, parseDateFromFilename } from '../smartCollections';

suite('SmartCollections', () => {
    test('parseDateFromFilename extracts DD-MM-YYYY', () => {
        const date = parseDateFromFilename('meeting_05-05-2026.md');
        assert.strictEqual(date!.getFullYear(), 2026);
        assert.strictEqual(date!.getMonth(), 4); // 0-indexed
        assert.strictEqual(date!.getDate(), 5);
    });

    test('parseDateFromFilename returns null for no date', () => {
        const date = parseDateFromFilename('readme.md');
        assert.strictEqual(date, null);
    });

    test('matchesCollection filters by tags (AND logic)', () => {
        const collection = { name: 'test', tags: ['meeting', 'team'], dateRange: null, query: null };
        const noteWithBoth = { tags: ['meeting', 'team', 'standup'], date: null, filePath: '' };
        const noteWithOne = { tags: ['meeting'], date: null, filePath: '' };
        assert.strictEqual(matchesCollection(noteWithBoth, collection), true);
        assert.strictEqual(matchesCollection(noteWithOne, collection), false);
    });

    test('matchesCollection filters by dateRange', () => {
        const collection = { name: 'test', tags: null, dateRange: 7, query: null };
        const recent = { tags: [], date: new Date(), filePath: '' };
        const old = { tags: [], date: new Date('2020-01-01'), filePath: '' };
        assert.strictEqual(matchesCollection(recent, collection), true);
        assert.strictEqual(matchesCollection(old, collection), false);
    });

    test('matchesCollection passes when no filters set', () => {
        const collection = { name: 'test', tags: null, dateRange: null, query: null };
        const note = { tags: [], date: null, filePath: '' };
        assert.strictEqual(matchesCollection(note, collection), true);
    });
});
