import { RuleTester } from '@typescript-eslint/rule-tester';
import { ESLintUtils } from '@typescript-eslint/utils';
import { afterAll, describe, it } from 'bun:test';

import createNoNewlineIfBodyClassEmpty from '../noNewlineIfBodyClassEmptyRule.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const createRule = ESLintUtils.RuleCreator(() => 'https://example.com/rule');
const rule = createNoNewlineIfBodyClassEmpty(createRule);

const ruleTester = new RuleTester();

ruleTester.run('no-newline-if-body-class-empty', rule, {
    valid: [
        // empty body on a single line
        'class Foo {}',
        // single line with a member
        'class Foo { foo() {} }',
        // multiline but has members
        'class Foo {\n    foo() {}\n}',
        // multiline empty but has a comment inside
        'class Foo {\n    // keep this\n}',
        // class expression, empty single line
        'const C = class {};',
    ],
    invalid: [
        {
            code: 'class Foo {\n}',
            output: 'class Foo {}',
            errors: [{ messageId: 'noNewLine' }],
        },
    ],
});
