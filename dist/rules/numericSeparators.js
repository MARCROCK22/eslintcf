export default function create(createRule) {
    return createRule({
        create(context) {
            return {
                Literal(node) {
                    const value = node.value;
                    if (typeof value !== 'number' && typeof value !== 'bigint' || Number.isNaN(value)) {
                        return;
                    }
                    // Hexadecimal, binary and octal literals (any case of the prefix) and exponents are left
                    // as they are: a separator right after the prefix is a syntax error.
                    if (/^0[box]/i.test(node.raw) || /e/i.test(node.raw)) {
                        return;
                    }
                    const [first, second,] = node.raw.replaceAll('_', '').split('.');
                    const result = `${parseNumber(first || '')}${second
                        ? `.${parseNumber(second)}`
                        : ''}`;
                    if (result !== node.raw) {
                        context.report({
                            messageId: 'numericSeparators',
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
                description: 'Forced to use numeric separators',
            },
            messages: {
                numericSeparators: 'Number its not using numeric separators as expected',
            },
            type: 'problem',
            schema: [],
            fixable: 'whitespace',
        },
        defaultOptions: [],
    });
}
function parseNumber(str) {
    return str.replaceAll(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, '_');
}
