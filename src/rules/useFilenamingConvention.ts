import type { ESLintUtils, } from '@typescript-eslint/utils';

export default function create(createRule: ReturnType<typeof ESLintUtils.RuleCreator>) {
    return createRule({
        create(context, options) {
            // @ts-expect-error
            const regex: undefined | RegExp = options[0].match instanceof RegExp
                // @ts-expect-error
                ? options[0].match
                : undefined;
            return {
                Program(node) {
                    if (regex !== undefined && !context.filename.match(regex)) {
                        context.report({
                            messageId: 'nosecomoponerle',
                            node,
                        });
                    }
                },
            };
        },
        name: 'use-filenaming-convention',
        meta: {
            docs: {
                description:
                    'Enforce naming conventions for JavaScript and TypeScript filenames.',
            },
            messages: {
                nosecomoponerle: 'Filename does not match regex.',
            },
            type: 'problem',
            schema: [{
                type: 'object',
            },],
        },
        defaultOptions: [{},],
    });
}
