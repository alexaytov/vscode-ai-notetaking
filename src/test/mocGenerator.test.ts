import * as assert from 'assert';
import { slugify, parseClusterResponse } from '../mocGenerator';

suite('MOCGenerator', () => {
    test('slugify converts to lowercase dashes', () => {
        assert.strictEqual(slugify('Hello World'), 'hello-world');
    });

    test('slugify removes special characters', () => {
        assert.strictEqual(slugify('C++ & Python!'), 'c-python');
    });

    test('slugify collapses multiple dashes', () => {
        assert.strictEqual(slugify('foo - bar -- baz'), 'foo-bar-baz');
    });

    test('parseClusterResponse parses valid JSON', () => {
        const response = '[{"topic":"Meetings","description":"Team meetings","noteIndices":[1,3]}]';
        const clusters = parseClusterResponse(response);
        assert.strictEqual(clusters.length, 1);
        assert.strictEqual(clusters[0].topic, 'Meetings');
        assert.deepStrictEqual(clusters[0].noteIndices, [1, 3]);
    });

    test('parseClusterResponse extracts JSON from wrapped response', () => {
        const response = 'Here are the clusters:\n[{"topic":"A","description":"desc","noteIndices":[1]}]\nDone!';
        const clusters = parseClusterResponse(response);
        assert.strictEqual(clusters.length, 1);
    });

    test('parseClusterResponse returns empty on invalid', () => {
        const clusters = parseClusterResponse('not json at all');
        assert.deepStrictEqual(clusters, []);
    });
});
