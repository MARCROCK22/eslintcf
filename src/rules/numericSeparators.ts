import type { ESLintUtils, } from '@typescript-eslint/utils';

export default function create(createRule: ReturnType<typeof ESLintUtils.RuleCreator>) {
    return createRule({
        create(context) {
            return {
                Literal(node) {
                    const value = node.value;
                    if (typeof value !== 'number' && typeof value !== 'bigint' || Number.isNaN(value)) {
                        return;
                    }

                    if (['e', '0x', '0b',].some((t) => node.raw.includes(t))) {
                        return;
                    }

                    const [first, second,] = node.raw.replaceAll('_', '').split('.');

                    const result = `${parseNumber(first || '')}${second
                        ? `.${parseNumber(second)}`
                        : ''}`;

                    if (result !== node.raw) {
                        context.report({
                            messageId: 'nosecomoponerle',
                            node,
                            fix(fixer) {
                                return fixer.replaceText(node, result);
                            },
                        });
                    }
                },
            };
        },
        name: 'numeric-separators',
        meta: {
            docs: {
                description:
                    'Forced to use numeric separators',
            },
            messages: {
                nosecomoponerle: 'Number its not using numeric separators as expected',
            },
            type: 'problem',
            schema: [],
            fixable: 'whitespace',
        },
        defaultOptions: [],
    });
}

function parseNumber(str: string) {
    return str.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, '_');
}