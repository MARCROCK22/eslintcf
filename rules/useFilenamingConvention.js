module.exports =
    /**
     * 
     * @param {ReturnType<import('@typescript-eslint/utils').ESLintUtils.RuleCreator>} createRule 
     * @returns 
     */
    function create(createRule) {
        return createRule({
            create(context, options) {
                /**
                 * @type {RegExp|undefined}
                */
                // @ts-expect-error
                const regex = options[0].match instanceof RegExp ? options[0].match : undefined
                return {
                    Program(node) {
                        if (regex !== undefined && !context.filename.match(regex)) {
                            context.report({
                                messageId: 'nosecomoponerle',
                                node: node
                            })
                        }
                    }
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
                }],
            },
            defaultOptions: [{}],
        });
    }