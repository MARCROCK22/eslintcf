export default function create(createRule) {
    return createRule({
        create(context) {
            return {
                ClassBody(node) {
                    const [x, y,] = node.range;
                    if (node.loc.end.line === node.loc.start.line) {
                        return;
                    }
                    if (context.sourceCode.getCommentsInside(node).length === 0 && node.body.length === 0) {
                        context.report({
                            messageId: 'noNewLine',
                            node,
                            fix(fixer) {
                                return fixer.removeRange([
                                    x + 2, y - 1,
                                ]);
                            },
                        });
                    }
                },
            };
        },
        name: 'no-newline-if-body-class-empty',
        meta: {
            docs: {
                description: 'No newline if body class is empty.',
            },
            messages: {
                noNewLine: 'Empty body class should not have a newline.',
            },
            type: 'suggestion',
            schema: [],
            fixable: 'whitespace',
        },
        defaultOptions: [],
    });
}
