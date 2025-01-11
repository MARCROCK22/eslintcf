module.exports =
    /**
     * 
     * @param {ReturnType<import('@typescript-eslint/utils').ESLintUtils.RuleCreator>} createRule 
     * @returns 
     */
    function create(createRule) {
        return createRule({
            create(context) {
                return {
                    Literal(node) {
                        if (!(typeof node.value === 'number' && !Number.isNaN(node.value) && node.value > 1e3)) {
                            return
                        }

                        const split = node.raw.split('_')

                        if (split.some((str, i) => str.length > 3 || (i !== 0 && str.length < 3))) {
                            return context.report({
                                messageId: 'nosecomoponerle',
                                node: node,
                                fix(fixer) {
                                    return fixer.replaceText(node, node.value.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, "_"))
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
                    nosecomoponerle: 'Number its not using numeric separators'
                },
                type: 'problem',
                schema: [],
                fixable: 'whitespace'
            },
            defaultOptions: [],
        });
    }