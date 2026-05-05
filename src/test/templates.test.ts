import * as assert from 'assert';
import { expandTemplateVariables } from '../templates';

suite('Templates', () => {
    test('expands {{date}} to current date', () => {
        const result = expandTemplateVariables('**Date:** {{date}}');
        assert.match(result, /\*\*Date:\*\* \d{2}-\d{2}-\d{4}/);
    });

    test('expands {{title}} to provided title', () => {
        const result = expandTemplateVariables('# {{title}}', 'My Note');
        assert.strictEqual(result, '# My Note');
    });

    test('uses placeholder when no title provided', () => {
        const result = expandTemplateVariables('# {{title}}');
        assert.strictEqual(result, '# Untitled');
    });

    test('leaves unknown variables unchanged', () => {
        const result = expandTemplateVariables('{{unknown}}');
        assert.strictEqual(result, '{{unknown}}');
    });

    test('handles multiple variables in one string', () => {
        const result = expandTemplateVariables('# {{title}}\n**Date:** {{date}}', 'Test');
        assert.match(result, /^# Test\n\*\*Date:\*\* \d{2}-\d{2}-\d{4}$/);
    });
});
