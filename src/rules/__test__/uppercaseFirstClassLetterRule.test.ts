import { RuleTester } from '@typescript-eslint/rule-tester';
import { ESLintUtils } from '@typescript-eslint/utils';
import { afterAll, describe, it } from 'bun:test';

import createUppercaseFirstClassLetter from '../uppercaseFirstClassLetterRule.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const createRule = ESLintUtils.RuleCreator(() => 'https://example.com/rule');
const rule = createUppercaseFirstClassLetter(createRule);

const ruleTester = new RuleTester();

ruleTester.run('uppercase-first-class-letter', rule, {
    valid: [
        'class Foo {}',
        'class FooBar {}',
        // does not start with a lowercase letter
        'class _Foo {}',
        'class $Foo {}',
        // class expressions are not declarations -> not checked
        'const x = class {};',
    ],
    invalid: [
        {
            code: 'class foo {}',
            errors: [{ messageId: 'uppercaseFirstClassLeter' }],
        },
        {
            code: 'class fooBar {}',
            errors: [{ messageId: 'uppercaseFirstClassLeter' }],
        },
    ],
});
