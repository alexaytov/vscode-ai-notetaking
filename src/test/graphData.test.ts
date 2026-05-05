import * as assert from 'assert';
import { buildGraphData, GraphData, GraphNode, GraphEdge } from '../graphData';

suite('GraphData', () => {
    test('buildGraphData returns empty graph for empty input', () => {
        const result = buildGraphData([]);
        assert.deepStrictEqual(result, { nodes: [], edges: [] });
    });

    test('buildGraphData creates note nodes', () => {
        const notes = [
            { filePath: '/workspace/note.md', tags: ['test'], links: [], summary: 'A summary' },
        ];
        const result = buildGraphData(notes);
        assert.strictEqual(result.nodes.length, 2); // 1 note + 1 tag
        const noteNode = result.nodes.find(n => n.type === 'note');
        assert.strictEqual(noteNode!.label, 'note.md');
        assert.strictEqual(noteNode!.summary, 'A summary');
    });

    test('buildGraphData creates tag nodes and edges', () => {
        const notes = [
            { filePath: '/workspace/a.md', tags: ['meeting', 'team'], links: [], summary: null },
        ];
        const result = buildGraphData(notes);
        const tagNodes = result.nodes.filter(n => n.type === 'tag');
        assert.strictEqual(tagNodes.length, 2);
        const tagEdges = result.edges.filter(e => e.type === 'tag');
        assert.strictEqual(tagEdges.length, 2);
    });

    test('buildGraphData creates link edges between notes', () => {
        const notes = [
            { filePath: '/workspace/a.md', tags: [], links: ['/workspace/b.md'], summary: null },
            { filePath: '/workspace/b.md', tags: [], links: [], summary: null },
        ];
        const result = buildGraphData(notes);
        const linkEdges = result.edges.filter(e => e.type === 'link');
        assert.strictEqual(linkEdges.length, 1);
        assert.strictEqual(linkEdges[0].source, '/workspace/a.md');
        assert.strictEqual(linkEdges[0].target, '/workspace/b.md');
    });

    test('buildGraphData deduplicates tag nodes across notes', () => {
        const notes = [
            { filePath: '/workspace/a.md', tags: ['shared'], links: [], summary: null },
            { filePath: '/workspace/b.md', tags: ['shared'], links: [], summary: null },
        ];
        const result = buildGraphData(notes);
        const tagNodes = result.nodes.filter(n => n.type === 'tag');
        assert.strictEqual(tagNodes.length, 1);
        assert.strictEqual(tagNodes[0].connections, 2);
    });
});
