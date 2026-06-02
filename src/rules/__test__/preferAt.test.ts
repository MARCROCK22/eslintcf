/*
Tests for the forked `prefer-at` rule (src/rules/preferAt.ts).

Covers all four ported paths from eslint-plugin-unicorn's test/prefer-at.js
(index access, `String#charAt`, `.slice(-n)[0]`/`.shift()`/`.pop()`, and
get-last functions) PLUS the new string-exemption cases (the customization:
`str[0]` is allowed when the object is a `string`).

unicorn's own tests are snapshot-based; here they are adapted to
`@typescript-eslint/rule-tester`'s explicit `errors`/`messageId` format. The
string-exemption cases are type-aware, so RuleTester runs with type information
(projectService). To run:
  bun add -d @typescript-eslint/rule-tester
  bun test src/rules/__test__/preferAt.test.ts
*/

import { RuleTester, } from '@typescript-eslint/rule-tester';
import { ESLintUtils, } from '@typescript-eslint/utils';

import createPreferAt from '../preferAt.js';

const createRule = ESLintUtils.RuleCreator(() => 'https://example.com/rule/prefer-at');
const rule = createPreferAt(createRule);

const ruleTester = new RuleTester({
    languageOptions: {
        parserOptions: {
            projectService: {
                allowDefaultProject: ['*.ts*',],
            },
            tsconfigRootDir: import.meta.dirname,
        },
    },
});

const withCheckAll = (code: string) => ({
    code,
    options: [{ checkAllIndexAccess: true, },] as const,
});

ruleTester.run('prefer-at', rule, {
    valid: [
        // --- negative index: not a `.length - n` pattern ----------------------
        'array.at(-1)',
        'array[array.length - 0];',
        'array[array.length + 1]',
        'array[array.length + -1]',
        'foo[bar.length - 1]',
        // LHS (assignment / update / delete targets) are never flagged
        'array[array.length - 1] = 1',
        'array[array.length - 1] %= 1',
        '++ array[array.length - 1]',
        'array[array.length - 1] --',
        'delete array[array.length - 1]',
        '([array[array.length - 1]] = [])',
        '({foo: array[array.length - 1] = 9} = {})',
        // without `checkAllIndexAccess`, plain positive index is fine
        'array[0]',
        'array[1]',

        // --- `checkAllIndexAccess: true` -------------------------------------
        withCheckAll('array[unknown]'),
        withCheckAll('array[-1]'),
        withCheckAll('array[1.5]'),
        withCheckAll('array[1n]'),
        withCheckAll('++array[1]'),

        // --- NEW: strings are exempt from positive index access --------------
        withCheckAll('const s = \'abc\'; s[0];'),
        withCheckAll('const s = \'abc\'; s[1];'),
        withCheckAll('declare const s: string; s[0];'),
        withCheckAll('declare const s: string; s[s.length - 2 + 1 - 1 + 0];'),
        withCheckAll('function f(p: string) { return p[0]; }'),
        withCheckAll('const s: string | string = \'a\'; s[0];'),

        // --- `String#charAt` -------------------------------------------------
        'string.charAt(string.length - 0);',
        'string.charAt(string.length + 1)',
        'string.charAt(string.length + -1)',
        'foo.charAt(bar.length - 1)',
        'string?.charAt?.(string.length - 1);',
        // without `checkAllIndexAccess`, a plain (non-negative) charAt is fine
        'string.charAt(9);',
        // checkAllIndexAccess still ignores extra-argument charAt
        withCheckAll('const offset = 5;const extraArgument = 6;string.charAt(offset + 9, extraArgument)'),

        // --- `.slice()` (one argument) ---------------------------------------
        'array.slice(-1)',
        'new array.slice(-1)',
        'array.slice(-0)[0]',
        'array.slice(-9).pop()',
        // single-argument `.slice(-n)` is only flagged when n === 1; n !== 1 is valid
        'array.slice(-9)[0]',
        'array.slice(-9).shift()',
        'array.slice(-1.1)[0]',
        'array.slice(-1)?.[0]',
        'array.slice?.(-1)[0]',
        'array.notSlice(-1)[0]',
        'array.slice()[0]',
        'array.slice(...[-1])[0]',
        'array.slice(-1).shift?.()',
        'array.slice(-1)?.shift()',
        'array.slice(-1).shift(...[])',
        'new array.slice(-1).shift()',
        // slice LHS
        'array.slice(-1)[0] += 1',
        '++ array.slice(-1)[0]',
        'array.slice(-1)[0] --',
        'delete array.slice(-1)[0]',
        // `.slice()` with 2 args where end is not start+1
        'array.slice(-9.1, -8.1)[0]',
        'array.slice(-unknown, -unknown2)[0]',
        'array.slice(-9.1, unknown)[0]',
        'array.slice(-9, unknown).pop()',
        'array.slice(-9, ...unknown)[0]',
        'array.slice(...[-9], unknown)[0]',

        // --- get-last functions ----------------------------------------------
        'new _.last(array)',
        '_.last(array, 2)',
        '_.last(...array)',
    ],
    invalid: [
        // --- negative index --------------------------------------------------
        {
            code: 'array[array.length - 1];',
            output: 'array.at(-1);',
            errors: [{ messageId: 'negativeIndex', },],
        },
        {
            code: 'array?.[array.length - 1];',
            output: 'array?.at(-1);',
            errors: [{ messageId: 'negativeIndex', },],
        },
        {
            code: 'function foo() { return arguments[arguments.length - 1]; }',
            errors: [{ messageId: 'negativeIndex', },],
        },
        // negative index is still flagged on strings (`.at(-1)` is clearer)
        {
            code: 'declare const s: string; s[s.length - 1];',
            output: 'declare const s: string; s.at(-1);',
            errors: [{ messageId: 'negativeIndex', },],
        },

        // --- `checkAllIndexAccess: true` -------------------------------------
        {
            ...withCheckAll('array[0]'),
            output: 'array.at(0)',
            errors: [{ messageId: 'index', },],
        },
        {
            ...withCheckAll('array[1]'),
            output: 'array.at(1)',
            errors: [{ messageId: 'index', },],
        },
        {
            ...withCheckAll('array[5 + 9]'),
            output: 'array.at(5 + 9)',
            errors: [{ messageId: 'index', },],
        },
        {
            ...withCheckAll('const offset = 5; array[offset + 9];'),
            output: 'const offset = 5; array.at(offset + 9);',
            errors: [{ messageId: 'index', },],
        },
        // arrays are NOT exempt (only strings are)
        {
            ...withCheckAll('const a = [1, 2]; a[0];'),
            output: 'const a = [1, 2]; a.at(0);',
            errors: [{ messageId: 'index', },],
        },
        {
            ...withCheckAll('declare const a: number[]; a[0];'),
            output: 'declare const a: number[]; a.at(0);',
            errors: [{ messageId: 'index', },],
        },

        // --- `String#charAt` -------------------------------------------------
        {
            code: 'string.charAt(string.length - 1);',
            output: null,
            errors: [{ messageId: 'stringCharAtNegative', suggestions: [{ messageId: 'useAt', output: 'string.at(- 1);', },], },],
        },
        {
            code: 'string?.charAt(string.length - 1);',
            output: null,
            errors: [{ messageId: 'stringCharAtNegative', suggestions: [{ messageId: 'useAt', output: 'string?.at(- 1);', },], },],
        },
        {
            code: 'some.string.charAt(some.string.length - 1);',
            output: null,
            errors: [{ messageId: 'stringCharAtNegative', suggestions: [{ messageId: 'useAt', output: 'some.string.at(- 1);', },], },],
        },
        {
            code: 'string.charAt((( string.length - 1 )));',
            output: null,
            errors: [{ messageId: 'stringCharAtNegative', suggestions: [{ messageId: 'useAt', output: 'string.at((( - 1 )));', },], },],
        },
        // `charAt` doesn't care about value when `checkAllIndexAccess` is on
        {
            ...withCheckAll('string.charAt(9)'),
            output: null,
            errors: [{ messageId: 'stringCharAt', suggestions: [{ messageId: 'useAt', output: 'string.at(9)', },], },],
        },
        {
            ...withCheckAll('string.charAt(unknown)'),
            output: null,
            errors: [{ messageId: 'stringCharAt', suggestions: [{ messageId: 'useAt', output: 'string.at(unknown)', },], },],
        },
        {
            ...withCheckAll('string.charAt(string.length - 1)'),
            output: null,
            errors: [{ messageId: 'stringCharAtNegative', suggestions: [{ messageId: 'useAt', output: 'string.at(- 1)', },], },],
        },

        // --- `.slice()` (one argument) ---------------------------------------
        {
            code: 'array.slice(-1)[0]',
            output: 'array.at(-1)',
            errors: [{ messageId: 'slice', },],
        },
        {
            code: 'array?.slice(-1)[0]',
            output: 'array?.at(-1)',
            errors: [{ messageId: 'slice', },],
        },
        {
            code: 'array.slice(-1).pop()',
            output: 'array.at(-1)',
            errors: [{ messageId: 'slice', },],
        },
        {
            code: 'array.slice(-1.0).shift()',
            output: 'array.at(-1.0)',
            errors: [{ messageId: 'slice', },],
        },
        // `.slice()` with 2 args, end is start+1
        {
            code: 'array.slice(-9, -8)[0]',
            output: 'array.at(-9)',
            errors: [{ messageId: 'slice', },],
        },
        {
            code: 'array.slice(-9, -8).pop()',
            output: 'array.at(-9)',
            errors: [{ messageId: 'slice', },],
        },
        {
            code: 'array.slice(-9, -8).shift()',
            output: 'array.at(-9)',
            errors: [{ messageId: 'slice', },],
        },
        // `.slice()` with 2 args, suggestion only (not safe to autofix)
        {
            code: 'array.slice(-9, unknown)[0]',
            output: null,
            errors: [{ messageId: 'slice', suggestions: [{ messageId: 'useAt', output: 'array.at(-9)', },], },],
        },
        {
            code: 'array.slice(-9, unknown).shift()',
            output: null,
            errors: [{ messageId: 'slice', suggestions: [{ messageId: 'useAt', output: 'array.at(-9)', },], },],
        },

        // --- get-last functions ----------------------------------------------
        {
            code: '_.last(array)',
            output: 'array.at(-1)',
            errors: [{ messageId: 'getLastFunction', },],
        },
        {
            code: 'lodash.last(array)',
            output: 'array.at(-1)',
            errors: [{ messageId: 'getLastFunction', },],
        },
        {
            code: 'underscore.last(array)',
            output: 'array.at(-1)',
            errors: [{ messageId: 'getLastFunction', },],
        },
        {
            code: '_.last(new Array)',
            output: '(new Array).at(-1)',
            errors: [{ messageId: 'getLastFunction', },],
        },
        {
            code: 'if (foo) _.last([bar])',
            output: 'if (foo) [bar].at(-1)',
            errors: [{ messageId: 'getLastFunction', },],
        },
        {
            code: 'function foo() { return _.last(arguments); }',
            errors: [{ messageId: 'getLastFunction', },],
        },
        // custom get-last functions via option
        {
            code: '_.last(getLast(utils.lastOne(array)))',
            options: [{ getLastElementFunctions: ['getLast', '  utils.lastOne  ',], },],
            // overlapping fix ranges → multiple autofix passes (array form required)
            output: [
                'getLast(utils.lastOne(array)).at(-1)',
                'utils.lastOne(array).at(-1).at(-1)',
                'array.at(-1).at(-1).at(-1)',
            ],
            errors: [
                { messageId: 'getLastFunction', },
                { messageId: 'getLastFunction', },
                { messageId: 'getLastFunction', },
            ],
        },
    ],
});
