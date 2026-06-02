/* eslint-disable @typescript-eslint/no-unnecessary-condition -- AST-traversal code forked from eslint-plugin-unicorn: bracket index access into AST tuples/arguments is intentional (`.at()` would widen to `T | undefined` and break `tsc`), and the defensive type-guard conditionals are faithful to unicorn's originals. */
import type { TSESLint, TSESTree, } from '@typescript-eslint/utils';

import { ESLintUtils, ASTUtils, } from '@typescript-eslint/utils';
import * as ts from 'typescript';

const {
    isOpeningBracketToken,
    isClosingBracketToken,
    getStaticValue,
} = ASTUtils;

import {
    shouldAddParenthesesToMemberExpressionObject,
    removeMemberExpressionProperty,
    getNegativeIndexLengthNode,
    isNodeMatchesNameOrPath,
    getParenthesizedRange,
    getParenthesizedText,
    isMemberExpression,
    removeLengthNode,
    isCallExpression,
    removeMethodCall,
    isParenthesized,
    isLeftHandSide,
    needsSemicolon,
    isMethodCall,
    isLiteral,
} from './preferAt/helpers.js';

/*
Forked from eslint-plugin-unicorn `prefer-at` (rules/prefer-at.js) — a complete
port of all four detection paths (index access, `String#charAt`, the first
element of `.slice(-n)` / `.shift()` / `.pop()`, and get-last functions such as
`_.last`) WITH autofix and suggestions, faithful to unicorn.

Difference vs unicorn (the one customization): in the INDEX-ACCESS path only,
when the indexed value is a `string`, positive index access (e.g. `str[0]`) is
NOT reported, because indexing a string by a non-negative index is idiomatic and
safe (`.at()` buys nothing there). Negative-index access (`str[str.length - 1]`)
is still reported there since `.at(-1)` is genuinely clearer. This exemption is
NOT applied to the `charAt`/`slice`/get-last paths.

Helpers live in `./preferAt/helpers.ts`, vendored from unicorn internals because
unicorn's package `exports` blocks deep subpath imports.
*/

// --- string exemption (the customization) -------------------------------------

function isStringType(type: ts.Type): boolean {
    if (type.isUnion()) {
        return type.types.every((member) => isStringType(member));
    }
    return (type.flags & ts.TypeFlags.StringLike) !== 0;
}

// --- rule-local predicates (vendored from rules/prefer-at.js) ------------------

const isArguments = (node: TSESTree.Node): boolean => node.type === 'Identifier' && node.name === 'arguments';

type LiteralNegativeInteger = { argument: TSESTree.NumberLiteral } & TSESTree.UnaryExpression;

const isLiteralNegativeInteger = (node: TSESTree.Node): node is LiteralNegativeInteger => node.type === 'UnaryExpression'
    && node.prefix
    && node.operator === '-'
    && node.argument.type === 'Literal'
    && Number.isInteger(node.argument.value)
    && (node.argument.value as number) > 0;

const isZeroIndexAccess = (node: TSESTree.Node): boolean => isMemberExpression(node.parent, {
    optional: false,
    computed: true,
})
    && node.parent.object === node
    && isLiteral(node.parent.property, 0);

const isArrayPopOrShiftCall = (node: TSESTree.Node, method: string): boolean => {
    // `node.parent` is the `.pop` / `.shift` member expression here.
    const memberExpression = node.parent as TSESTree.MemberExpression;
    return isMethodCall(memberExpression.parent, {
        method,
        argumentsLength: 0,
        optionalCall: false,
        optionalMember: false,
    })
        && memberExpression.object === node;
};

const isArrayPopCall = (node: TSESTree.Node): boolean => isArrayPopOrShiftCall(node, 'pop');
const isArrayShiftCall = (node: TSESTree.Node): boolean => isArrayPopOrShiftCall(node, 'shift');

function checkSliceCall(node: TSESTree.CallExpression): {
    safeToFix: boolean;
    firstElementGetMethod: string;
} | undefined {
    const sliceArgumentsLength = node.arguments.length;
    const [startIndexNode, endIndexNode,] = node.arguments;

    if (!isLiteralNegativeInteger(startIndexNode)) {
        return undefined;
    }

    let firstElementGetMethod = '';
    if (isZeroIndexAccess(node)) {
        if (isLeftHandSide(node.parent)) {
            return undefined;
        }

        firstElementGetMethod = 'zero-index';
    } else if (isArrayShiftCall(node)) {
        firstElementGetMethod = 'shift';
    } else if (isArrayPopCall(node)) {
        firstElementGetMethod = 'pop';
    }

    if (!firstElementGetMethod) {
        return undefined;
    }

    const startIndex = -Number(startIndexNode.argument.value);
    if (sliceArgumentsLength === 1) {
        if (
            startIndexNode.argument.value === 1
            && (
                firstElementGetMethod === 'zero-index'
                || firstElementGetMethod === 'shift'
                || firstElementGetMethod === 'pop' && startIndex === -1
            )
        ) {
            return {
                safeToFix: true,
                firstElementGetMethod,
            };
        }

        return undefined;
    }

    if (
        isLiteralNegativeInteger(endIndexNode)
        && -Number(endIndexNode.argument.value) === startIndex + 1
    ) {
        return {
            safeToFix: true,
            firstElementGetMethod,
        };
    }

    if (firstElementGetMethod === 'pop') {
        return undefined;
    }

    return {
        safeToFix: false,
        firstElementGetMethod,
    };
}

const lodashLastFunctions = [
    '_.last',
    'lodash.last',
    'underscore.last',
];

interface Options {
    checkAllIndexAccess?: boolean;
    getLastElementFunctions?: string[];
}

export default function create(createRule: ReturnType<typeof ESLintUtils.RuleCreator>) {
    return createRule({
        create(context) {
            const options = (context.options.at(0) ?? {}) as Options;
            const checkAllIndexAccess = options.checkAllIndexAccess ?? false;
            const getLastElementFunctions = options.getLastElementFunctions ?? [];
            const getLastFunctions = [...getLastElementFunctions, ...lodashLastFunctions,];
            const { sourceCode, } = context;

            // Resolve the static type of a node; null when type info is unavailable
            // (so the rule still works as a plain syntactic rule without a program).
            const getNodeType = (node: TSESTree.Node): ts.Type | null => {
                try {
                    const services = ESLintUtils.getParserServices(context, true);
                    if (!services.program) {
                        return null;
                    }
                    return services.getTypeAtLocation(node);
                } catch {
                    return null;
                }
            };

            // `.slice()`
            const checkSlice = (sliceCall: TSESTree.CallExpression): boolean => {
                if (!isMethodCall(sliceCall, {
                    method: 'slice',
                    minimumArguments: 1,
                    maximumArguments: 2,
                    optionalCall: false,
                })) {
                    return false;
                }

                const result = checkSliceCall(sliceCall);
                if (!result) {
                    return false;
                }

                const { safeToFix, firstElementGetMethod, } = result;
                // `isMethodCall` guarantees the callee is a `.slice` member expression.
                const callee = sliceCall.callee as TSESTree.MemberExpression;

                function* fix(fixer: TSESLint.RuleFixer): IterableIterator<TSESLint.RuleFix> {
                    // `.slice` to `.at`
                    yield fixer.replaceText(callee.property, 'at');

                    // Remove extra arguments
                    if (sliceCall.arguments.length !== 1) {
                        const [, start,] = getParenthesizedRange(sliceCall.arguments.at(0)!, context);
                        const [end,] = (sourceCode.getLastToken(sliceCall) as TSESTree.Token).range;
                        yield fixer.removeRange([start, end,]);
                    }

                    // Remove `[0]`, `.shift()`, or `.pop()`.
                    if (firstElementGetMethod === 'zero-index') {
                        yield removeMemberExpressionProperty(fixer, sliceCall.parent as TSESTree.MemberExpression, context);
                    } else {
                        // `removeMethodCall` is a generator — delegate with `yield*` so its
                        // individual fixes are emitted (a plain `yield` would emit the generator
                        // object itself and fail ESLint's `assertValidFix`).
                        yield* removeMethodCall(fixer, sliceCall.parent.parent as TSESTree.CallExpression, context);
                    }
                }

                if (safeToFix) {
                    context.report({
                        node: callee.property,
                        messageId: 'slice',
                        fix,
                    });
                } else {
                    context.report({
                        node: callee.property,
                        messageId: 'slice',
                        suggest: [{
                            messageId: 'useAt',
                            fix,
                        },],
                    });
                }

                return true;
            };

            // `string.charAt`
            const checkCharAt = (node: TSESTree.CallExpression): boolean => {
                if (!isMethodCall(node, {
                    method: 'charAt',
                    argumentsLength: 1,
                    optionalCall: false,
                })) {
                    return false;
                }

                // `isMethodCall` guarantees the callee is a `.charAt` member expression.
                const callee = node.callee as TSESTree.MemberExpression;
                const [indexNode,] = node.arguments;
                const lengthNode = getNegativeIndexLengthNode(indexNode, callee.object);

                // `String#charAt` don't care about index value, we assume it's always number
                if (!lengthNode && !checkAllIndexAccess) {
                    return false;
                }

                context.report({
                    node: indexNode,
                    messageId: lengthNode
                        ? 'stringCharAtNegative'
                        : 'stringCharAt',
                    suggest: [{
                        messageId: 'useAt',
                        *fix(fixer: TSESLint.RuleFixer): IterableIterator<TSESLint.RuleFix> {
                            if (lengthNode) {
                                yield removeLengthNode(lengthNode, fixer, context);
                            }

                            yield fixer.replaceText(callee.property, 'at');
                        },
                    },],
                });

                return true;
            };

            // get-last functions (`_.last`, `lodash.last`, `underscore.last`, plus option)
            const checkGetLast = (node: TSESTree.CallExpression): boolean => {
                if (!isCallExpression(node, {
                    argumentsLength: 1,
                    optional: false,
                })) {
                    return false;
                }

                const matchedFunction = getLastFunctions.find((nameOrPath) => isNodeMatchesNameOrPath(node.callee, nameOrPath));
                if (!matchedFunction) {
                    return false;
                }

                const [array,] = node.arguments;

                if (isArguments(array)) {
                    context.report({
                        node: node.callee,
                        messageId: 'getLastFunction',
                        data: { description: matchedFunction.trim(), },
                    });
                    return true;
                }

                context.report({
                    node: node.callee,
                    messageId: 'getLastFunction',
                    data: { description: matchedFunction.trim(), },
                    fix(fixer: TSESLint.RuleFixer): TSESLint.RuleFix {
                        let fixed = getParenthesizedText(array, context);

                        if (
                            !isParenthesized(array, context)
                            && shouldAddParenthesesToMemberExpressionObject(array, context)
                        ) {
                            fixed = `(${fixed})`;
                        }

                        fixed = `${fixed}.at(-1)`;

                        const tokenBefore = sourceCode.getTokenBefore(node);
                        if (needsSemicolon(tokenBefore, context, fixed)) {
                            fixed = `;${fixed}`;
                        }

                        return fixer.replaceText(node, fixed);
                    },
                });

                return true;
            };

            return {
                // Index access
                MemberExpression(node) {
                    if (!node.computed || isLeftHandSide(node)) {
                        return;
                    }
                    const indexNode = node.property;
                    const lengthNode = getNegativeIndexLengthNode(indexNode, node.object);

                    let isPositiveIndex = false;
                    if (!lengthNode) {
                        if (!checkAllIndexAccess) {
                            return;
                        }
                        // Only if we are sure it's a non-negative integer.
                        const staticValue = getStaticValue(indexNode, context.sourceCode.getScope(indexNode));
                        if (!staticValue || !Number.isInteger(staticValue.value) || (staticValue.value as number) < 0) {
                            return;
                        }
                        isPositiveIndex = true;
                    }

                    // Customization: a string is always safe to index by a non-negative
                    // index, so don't flag `str[0]`. Negative-index (`str[str.length-1]`)
                    // is left flagged since `.at(-1)` is genuinely clearer there.
                    if (isPositiveIndex) {
                        const objectType = getNodeType(node.object);
                        if (objectType && isStringType(objectType)) {
                            return;
                        }
                    }

                    // Faithful to unicorn: `arguments[arguments.length - 1]` is reported
                    // but NOT autofixed (`arguments.at(-1)` is not valid in all targets).
                    if (isArguments(node.object)) {
                        context.report({
                            node: indexNode,
                            messageId: lengthNode
                                ? 'negativeIndex'
                                : 'index',
                        });
                        return;
                    }

                    context.report({
                        node: indexNode,
                        messageId: lengthNode
                            ? 'negativeIndex'
                            : 'index',
                        *fix(fixer) {
                            if (lengthNode) {
                                yield removeLengthNode(lengthNode, fixer, context);
                            }

                            // Only remove space for `foo[foo.length - 1]`
                            if (
                                indexNode.type === 'BinaryExpression'
                                && indexNode.operator === '-'
                                && indexNode.left === lengthNode
                                && indexNode.right.type === 'Literal'
                                && /^\d+$/.test(indexNode.right.raw)
                            ) {
                                const numberNode = indexNode.right;
                                const tokenBefore = sourceCode.getTokenBefore(numberNode);
                                if (
                                    tokenBefore?.type === 'Punctuator'
                                    && tokenBefore.value === '-'
                                    && /^\s+$/.test(sourceCode.text.slice(tokenBefore.range.at(1), numberNode.range.at(0)))
                                ) {
                                    yield fixer.removeRange([tokenBefore.range.at(1)!, numberNode.range.at(0)!,]);
                                }
                            }

                            const isOptional = node.optional;
                            const openingBracketToken = sourceCode.getTokenBefore(indexNode, isOpeningBracketToken)!;
                            yield fixer.replaceText(openingBracketToken, `${isOptional
                                ? ''
                                : '.'}at(`);

                            const closingBracketToken = sourceCode.getTokenAfter(indexNode, isClosingBracketToken)!;
                            yield fixer.replaceText(closingBracketToken, ')');
                        },
                    });
                },
                CallExpression(node) {
                    // Each check is mutually exclusive by method/shape; run in order and
                    // stop after the first that reports (mirrors unicorn's separate
                    // `context.on('CallExpression', …)` listeners, each of which returns
                    // early).
                    if (checkCharAt(node)) {
                        return;
                    }
                    if (checkSlice(node)) {
                        return;
                    }
                    checkGetLast(node);
                },
            };
        },
        name: 'prefer-at',
        meta: {
            type: 'suggestion',
            docs: {
                description: 'Prefer `.at(…)` method for index access and `String#charAt()`, but allow non-negative index access on strings.',
            },
            fixable: 'code',
            hasSuggestions: true,
            messages: {
                negativeIndex: 'Prefer `.at(…)` over `[….length - index]`.',
                index: 'Prefer `.at(…)` over index access.',
                stringCharAtNegative: 'Prefer `String#at(…)` over `String#charAt(….length - index)`.',
                stringCharAt: 'Prefer `String#at(…)` over `String#charAt(…)`.',
                slice: 'Prefer `.at(…)` over the first element from `.slice(…)`.',
                getLastFunction: 'Prefer `.at(-1)` over `{{description}}(…)` to get the last element.',
                useAt: 'Use `.at(…)`.',
            },
            schema: [{
                type: 'object',
                additionalProperties: false,
                properties: {
                    getLastElementFunctions: {
                        type: 'array',
                        uniqueItems: true,
                        description: 'Additional functions that return the last element.',
                    },
                    checkAllIndexAccess: {
                        type: 'boolean',
                        description: 'Whether to also check non-negative integer index access.',
                    },
                },
            },],
        },
        defaultOptions: [{},],
    });
}
