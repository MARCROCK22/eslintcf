import { ESLintUtils, } from '@typescript-eslint/utils';
import uppercaseFirstClassLetterRule from './uppercaseFirstClassLetterRule.js';
import noNewlineIfBodyClassEmptyRule from './noNewlineIfBodyClassEmptyRule.js';
import useFilenamingConvention from './useFilenamingConvention.js';
import numericSeparators from './numericSeparators.js';
const createRule = ESLintUtils.RuleCreator((name) => `https://example.com/rule/${name}`);
const plugin = {
    rules: {
        // @ts-expect-error
        'uppercase-first-class-letter': uppercaseFirstClassLetterRule(createRule),
        // @ts-expect-error
        'no-newline-if-body-class-empty': noNewlineIfBodyClassEmptyRule(createRule),
        // @ts-expect-error
        'use-filenaming-convention': useFilenamingConvention(createRule),
        // @ts-expect-error
        'numeric-separators': numericSeparators(createRule),
    },
};
export default plugin;
