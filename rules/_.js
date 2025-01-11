const { ESLintUtils } = require('@typescript-eslint/utils');

const createRule = ESLintUtils.RuleCreator(
    name => `https://example.com/rule/${name}`,
);
/**
 * @type {import('eslint').ESLint.Plugin}
 */
const plugin = {
    rules: {
        // @ts-expect-error
        'uppercase-first-class-letter': require('./uppercaseFirstClassLetterRule')(createRule),
        // @ts-expect-error
        'no-newline-if-body-class-empty': require('./noNewlineIfBodyClassEmptyRule')(createRule),
        // @ts-expect-error
        'use-filenaming-convention': require('./useFilenamingConvention')(createRule),
    }
}

module.exports = plugin