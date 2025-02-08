import type { ESLintUtils, } from '@typescript-eslint/utils';

import path from 'path';

export default function create(createRule: ReturnType<typeof ESLintUtils.RuleCreator>) {
    return createRule({
        create(context, options) {
            // @ts-expect-error
            const regex: undefined | RegExp = options[0].match instanceof RegExp
                // @ts-expect-error
                ? options[0].match
                : undefined;
            if (regex) {
                return {
                    Program(node) {
                        const filename = path.basename(context.filename);
                        if (!regex.test(filename)) {
                            context.report({
                                messageId: 'invalidFilename',
                                data: { filename, },
                                node,
                            });
                        }
                    },
                };
            }
            return {};
        },
        name: 'use-filenaming-convention',
        meta: {
            docs: {
                description: 'Enforce naming conventions for JavaScript and TypeScript filenames.',
            },
            messages: {
                invalidFilename: 'The filename "{{ filename }}" does not follow the naming convention.',
            },
            type: 'problem',
            schema: [{
                type: 'object',
            },],
        },
        defaultOptions: [{},],
    });
}
