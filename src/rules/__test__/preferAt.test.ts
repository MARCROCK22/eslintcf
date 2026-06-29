/*
Tests for the forked `prefer-at` rule (src/rules/preferAt.ts).

Covers all four ported paths from eslint-plugin-unicorn's test/prefer-at.js
(index access, `String#charAt`, `.slice(-n)[0]`/`.shift()`/`.pop()`, and
get-last functions) PLUS the split-exemption cases (the customization:
`x.split('<non-empty>')[0]` is allowed — the first element is always present).

unicorn's own tests are snapshot-based; here they are adapted to
`@typescript-eslint/rule-tester`'s explicit `errors`/`messageId` format. To run:
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

        // --- NEW: `x.split('<non-empty>')[0]` is exempt (first element present)
        // magic-string separator
        withCheckAll('\'a.b\'.split(\'.\')[0];'),
        withCheckAll('\'a b\'.split(\' \')[0];'),
        // non-magic separator (named constant, resolved statically)
        withCheckAll('const SEP = \'.\'; \'a.b\'.split(SEP)[0];'),
        // empty value is still fine when the separator is non-empty
        withCheckAll('\'\'.split(\'.\')[0];'),
        // optional chaining on the split result
        withCheckAll('\'a.b\'.split(\'.\')?.[0];'),
        // `.at(0)` on an UNSAFE split stays (correctly `T | undefined`)
        withCheckAll('\'a.b\'.split(\'\').at(0);'),
        withCheckAll('declare const sep: string; \'a.b\'.split(sep).at(0);'),
        // only `.at(0)` is converted — other indices / non-split receivers stay
        withCheckAll('\'a.b\'.split(\'.\').at(1);'),
        withCheckAll('[1, 2, 3,].at(0);'),
        // index is not a literal `0` (a resolved const member could be mutated) → stays
        withCheckAll('const C = { i: 0 }; \'a.b\'.split(\'.\').at(C.i);'),

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
        // --- NEW: split cases that are NOT provably safe (still flagged) ------
        // empty separator: `''.split('')` is `[]` → [0] is undefined
        {
            ...withCheckAll('\'\'.split(\'\')[0];'),
            output: '\'\'.split(\'\').at(0);',
            errors: [{ messageId: 'index', },],
        },
        // dynamic separator: cannot prove it is non-empty
        {
            ...withCheckAll('declare const sep: string; \'a.b\'.split(sep)[0];'),
            output: 'declare const sep: string; \'a.b\'.split(sep).at(0);',
            errors: [{ messageId: 'index', },],
        },
        // only index 0 is guaranteed present
        {
            ...withCheckAll('\'a.b\'.split(\'.\')[1];'),
            output: '\'a.b\'.split(\'.\').at(1);',
            errors: [{ messageId: 'index', },],
        },
        // a `limit` argument breaks the guarantee (`split(x, 0)` can be empty)
        {
            ...withCheckAll('\'a.b\'.split(\'.\', 2)[0];'),
            output: '\'a.b\'.split(\'.\', 2).at(0);',
            errors: [{ messageId: 'index', },],
        },
        // --- NEW (inverse): `.at(0)` on a safe split → autofix to `[0]` ------
        {
            ...withCheckAll('\'a.b\'.split(\'.\').at(0)'),
            output: '\'a.b\'.split(\'.\')[0]',
            errors: [{ messageId: 'splitIndexAccess', },],
        },
        // non-magic separator (named constant)
        {
            ...withCheckAll('const SEP = \'.\'; \'a.b\'.split(SEP).at(0);'),
            output: 'const SEP = \'.\'; \'a.b\'.split(SEP)[0];',
            errors: [{ messageId: 'splitIndexAccess', },],
        },
        // the ranked.ts case: a trailing non-null assertion is preserved
        {
            ...withCheckAll('\'a.b\'.split(\'.\').at(0)!'),
            output: '\'a.b\'.split(\'.\')[0]!',
            errors: [{ messageId: 'splitIndexAccess', },],
        },
        // BUG 1 regression: parenthesized object must keep its closing paren
        {
            ...withCheckAll('(\'a.b\'.split(\'.\')).at(0)'),
            output: '(\'a.b\'.split(\'.\'))[0]',
            errors: [{ messageId: 'splitIndexAccess', },],
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
