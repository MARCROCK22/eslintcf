import { RuleTester } from '@typescript-eslint/rule-tester';
import { ESLintUtils } from '@typescript-eslint/utils';
import { afterAll, describe, it } from 'bun:test';

import createUseFilenamingConvention from '../useFilenamingConvention.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const createRule = ESLintUtils.RuleCreator(() => 'https://example.com/rule');
const rule = createUseFilenamingConvention(createRule);

const ruleTester = new RuleTester();

// camelCase + .ts
const camelCaseTs = { match: /^[a-z][A-Za-z0-9]*\.ts$/ };

ruleTester.run('use-filenaming-convention', rule, {
    valid: [
        {
            code: 'export const x = 1;',
            filename: 'goodName.ts',
            options: [camelCaseTs],
        },
        // path is reduced to its basename before testing
        {
            code: 'export const x = 1;',
            filename: '/some/dir/anotherGood.ts',
            options: [camelCaseTs],
        },
        // no `match` option -> rule is a no-op (any filename allowed)
        {
            code: 'export const x = 1;',
            filename: 'Whatever_Name.ts',
            options: [{}],
        },
    ],
    invalid: [
        {
            code: 'export const x = 1;',
            filename: 'Bad_Name.ts',
            options: [camelCaseTs],
            errors: [{ messageId: 'invalidFilename' }],
        },
        {
            code: 'export const x = 1;',
            filename: '/some/dir/PascalCase.ts',
            options: [camelCaseTs],
            errors: [{ messageId: 'invalidFilename' }],
        },
    ],
});
