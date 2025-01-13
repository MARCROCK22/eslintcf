module.exports =
    /**
     * 
     * @param {ReturnType<import('@typescript-eslint/utils').ESLintUtils.RuleCreator>} createRule 
     * @returns 
     */
    function create(createRule) {
        return createRule({
            create(context) {

                /**
                 * 
                 * @param {string} str 
                 */
                function parseNumber(str) {
                    return str.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, "_");
                }

                return {
                    Literal(node) {
                        const value = node.value;
                        if ((typeof value !== 'number' && typeof value !== 'bigint') || Number.isNaN(value)) {
                            return
                        }

                        if (['e', '0x', '0b'].some(t => node.raw.includes(t)))
                            return;

                        const [first, second] = node.raw.replaceAll('_', '').split('.')

                        const result = `${parseNumber(first ?? '')}${second ? `.${parseNumber(second)}` : ''}`;

                        if (result !== node.raw) {
                            return context.report({
                                messageId: 'nosecomoponerle',
                                node: node,
                                fix(fixer) {
                                    return fixer.replaceText(node, result)
                                }
                            })
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
                fixable: 'whitespace'
            },
            defaultOptions: [],
        });
    }