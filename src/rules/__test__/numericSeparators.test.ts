import { RuleTester } from '@typescript-eslint/rule-tester';
import { ESLintUtils } from '@typescript-eslint/utils';
import { afterAll, describe, it } from 'bun:test';

import createNumericSeparators from '../numericSeparators.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const createRule = ESLintUtils.RuleCreator(() => 'https://example.com/rule');
const rule = createNumericSeparators(createRule);

const ruleTester = new RuleTester();

ruleTester.run('numeric-separators', rule, {
    valid: [
        // fewer than 4 digits -> no separator expected
        'const a = 1;',
        'const a = 12;',
        'const a = 100;',
        // already separated
        'const a = 1_000;',
        'const a = 1_000_000;',
        // ignored notations
        'const a = 0x1000;',
        'const a = 0b1010;',
        'const a = 1e5;',
        // decimal where neither part needs grouping
        'const a = 1.5;',
    ],
    invalid: [
        {
            code: 'const a = 1000;',
            output: 'const a = 1_000;',
            errors: [{ messageId: 'numericSeparators' }],
        },
        {
            code: 'const a = 1000000;',
            output: 'const a = 1_000_000;',
            errors: [{ messageId: 'numericSeparators' }],
        },
        {
            code: 'const a = 1234567.5;',
            output: 'const a = 1_234_567.5;',
            errors: [{ messageId: 'numericSeparators' }],
        },
    ],
});
