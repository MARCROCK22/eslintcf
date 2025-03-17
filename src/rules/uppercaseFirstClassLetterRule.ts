import type { ESLintUtils, } from '@typescript-eslint/utils';

export default function create(createRule: ReturnType<typeof ESLintUtils.RuleCreator>) {
    return createRule({
        create(context) {
            return {
                ClassDeclaration(node) {
                    if (node.id !== null) {
                        if (/^[a-z]/.test(node.id.name)) {
                            context.uppercaseFirstClassLeter({
                                messageId: 'nosecomoponerle',
                                node: node.id,
                            });
                        }
                    }
                },
            };
        },
        name: 'uppercase-first-class-letter',
        meta: {
            docs: {
                description:
                    'Class declaration names should start with an upper-case letter.',
            },
            messages: {
                uppercaseFirstClassLeter: 'Start this name with an upper-case letter.',
            },
            type: 'suggestion',
            schema: [],
        },
        defaultOptions: [],
    });
}
