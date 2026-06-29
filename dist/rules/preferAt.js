import { ASTUtils, } from '@typescript-eslint/utils';
const { isOpeningBracketToken, isClosingBracketToken, getStaticValue, } = ASTUtils;
import { shouldAddParenthesesToMemberExpressionObject, removeMemberExpressionProperty, getNegativeIndexLengthNode, isNodeMatchesNameOrPath, getParenthesizedRange, getParenthesizedText, isMemberExpression, removeLengthNode, isCallExpression, removeMethodCall, isParenthesized, isLeftHandSide, needsSemicolon, isMethodCall, isLiteral, } from './preferAt/helpers.js';
/*
Forked from eslint-plugin-unicorn `prefer-at` (rules/prefer-at.js) — a complete
port of all four detection paths (index access, `String#charAt`, the first
element of `.slice(-n)` / `.shift()` / `.pop()`, and get-last functions such as
`_.last`) WITH autofix and suggestions, faithful to unicorn.

Difference vs unicorn (the one customization): in the INDEX-ACCESS path only,
`<expr>.split('<non-empty>')[0]` is NOT reported, because `String#split` with a
non-empty separator always yields a non-empty array — the first element is
always present, so `.at(0)` would only widen the type to `string | undefined`.
The separator is resolved statically, so named constants count (not just magic
strings); an empty or dynamic separator, a `limit` argument, or any index other
than `0` is still reported. This exemption is NOT applied to the
`charAt`/`slice`/get-last paths.

Helpers live in `./preferAt/helpers.ts`, vendored from unicorn internals because
unicorn's package `exports` blocks deep subpath imports.
*/
// --- rule-local predicates (vendored from rules/prefer-at.js) ------------------
const isArguments = (node) => node.type === 'Identifier' && node.name === 'arguments';
const isLiteralNegativeInteger = (node) => node.type === 'UnaryExpression'
    && node.prefix
    && node.operator === '-'
    && node.argument.type === 'Literal'
    && Number.isInteger(node.argument.value)
    && node.argument.value > 0;
const isZeroIndexAccess = (node) => isMemberExpression(node.parent, {
    optional: false,
    computed: true,
})
    && node.parent.object === node
    && isLiteral(node.parent.property, 0);
const isArrayPopOrShiftCall = (node, method) => {
    // `node.parent` is the `.pop` / `.shift` member expression here.
    const memberExpression = node.parent;
    return isMethodCall(memberExpression.parent, {
        method,
        argumentsLength: 0,
        optionalCall: false,
        optionalMember: false,
    })
        && memberExpression.object === node;
};
const isArrayPopCall = (node) => isArrayPopOrShiftCall(node, 'pop');
const isArrayShiftCall = (node) => isArrayPopOrShiftCall(node, 'shift');
function checkSliceCall(node) {
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
    }
    else if (isArrayShiftCall(node)) {
        firstElementGetMethod = 'shift';
    }
    else if (isArrayPopCall(node)) {
        firstElementGetMethod = 'pop';
    }
    if (!firstElementGetMethod) {
        return undefined;
    }
    const startIndex = -Number(startIndexNode.argument.value);
    if (sliceArgumentsLength === 1) {
        if (startIndexNode.argument.value === 1
            && (firstElementGetMethod === 'zero-index'
                || firstElementGetMethod === 'shift'
                || firstElementGetMethod === 'pop' && startIndex === -1)) {
            return {
                safeToFix: true,
                firstElementGetMethod,
            };
        }
        return undefined;
    }
    if (isLiteralNegativeInteger(endIndexNode)
        && -Number(endIndexNode.argument.value) === startIndex + 1) {
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
export default function create(createRule) {
    return createRule({
        create(context) {
            const options = (context.options.at(0) ?? {});
            const checkAllIndexAccess = options.checkAllIndexAccess ?? false;
            const getLastElementFunctions = options.getLastElementFunctions ?? [];
            const getLastFunctions = [...getLastElementFunctions, ...lodashLastFunctions,];
            const { sourceCode, } = context;
            // `<expr>.split('<non-empty>')[0]` — the first element is always present.
            // Separator resolved statically so named constants count, not just magic
            // strings; requires exactly one argument (no `limit`) and a non-empty string.
            // Syntactic (no type info): assumes a `String`/`Array` receiver — a custom
            // `.split()` returning a possibly-empty non-array is out of scope.
            const isFirstSplitElementAlwaysPresent = (objectNode) => {
                if (!isMethodCall(objectNode, {
                    method: 'split',
                    argumentsLength: 1,
                    optionalCall: false,
                    optionalMember: false,
                })) {
                    return false;
                }
                const [separatorNode,] = objectNode.arguments;
                const separator = getStaticValue(separatorNode, sourceCode.getScope(separatorNode));
                return separator !== null
                    && typeof separator.value === 'string'
                    && separator.value.length > 0;
            };
            // `.slice()`
            const checkSlice = (sliceCall) => {
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
                const callee = sliceCall.callee;
                function* fix(fixer) {
                    // `.slice` to `.at`
                    yield fixer.replaceText(callee.property, 'at');
                    // Remove extra arguments
                    if (sliceCall.arguments.length !== 1) {
                        const [, start,] = getParenthesizedRange(sliceCall.arguments.at(0), context);
                        const [end,] = sourceCode.getLastToken(sliceCall).range;
                        yield fixer.removeRange([start, end,]);
                    }
                    // Remove `[0]`, `.shift()`, or `.pop()`.
                    if (firstElementGetMethod === 'zero-index') {
                        yield removeMemberExpressionProperty(fixer, sliceCall.parent, context);
                    }
                    else {
                        // `removeMethodCall` is a generator — delegate with `yield*` so its
                        // individual fixes are emitted (a plain `yield` would emit the generator
                        // object itself and fail ESLint's `assertValidFix`).
                        yield* removeMethodCall(fixer, sliceCall.parent.parent, context);
                    }
                }
                if (safeToFix) {
                    context.report({
                        node: callee.property,
                        messageId: 'slice',
                        fix,
                    });
                }
                else {
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
            const checkCharAt = (node) => {
                if (!isMethodCall(node, {
                    method: 'charAt',
                    argumentsLength: 1,
                    optionalCall: false,
                })) {
                    return false;
                }
                // `isMethodCall` guarantees the callee is a `.charAt` member expression.
                const callee = node.callee;
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
                            *fix(fixer) {
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
            const checkGetLast = (node) => {
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
                    fix(fixer) {
                        let fixed = getParenthesizedText(array, context);
                        if (!isParenthesized(array, context)
                            && shouldAddParenthesesToMemberExpressionObject(array, context)) {
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
            // INVERSE of the index path: `<expr>.split('<non-empty>').at(0)` always has
            // a first element, and `.at(0)` is `T | undefined` while `[0]` is `T` — so
            // here prefer (and autofix to) index access.
            const checkSplitAt = (node) => {
                if (!isMethodCall(node, {
                    method: 'at',
                    argumentsLength: 1,
                    optionalCall: false,
                    optionalMember: false,
                })) {
                    return false;
                }
                const callee = node.callee;
                const [indexNode,] = node.arguments;
                // Require a LITERAL `0` — NOT a value `getStaticValue` resolves to 0 (which
                // can be a mutated const member, e.g. `C.i` after `Object.assign`). The
                // `.at`→`[]` rewrite is equivalent only for a literal non-negative index.
                if (!isLiteral(indexNode, 0) || !isFirstSplitElementAlwaysPresent(callee.object)) {
                    return false;
                }
                context.report({
                    node: callee.property,
                    messageId: 'splitIndexAccess',
                    fix(fixer) {
                        // Parenthesis-aware end: `('a'.split('.')).at(0)` → `('a'.split('.'))[0]`.
                        // A raw `callee.object.range` would land before the closing paren and
                        // eat it, producing invalid syntax.
                        const [, objectEnd,] = getParenthesizedRange(callee.object, context);
                        const [, callEnd,] = node.range;
                        return fixer.replaceTextRange([objectEnd, callEnd,], `[${sourceCode.getText(indexNode)}]`);
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
                    if (!lengthNode) {
                        if (!checkAllIndexAccess) {
                            return;
                        }
                        // Only if we are sure it's a non-negative integer.
                        const staticValue = getStaticValue(indexNode, sourceCode.getScope(indexNode));
                        if (!staticValue || !Number.isInteger(staticValue.value) || staticValue.value < 0) {
                            return;
                        }
                        // Customization: a LITERAL `<expr>.split('<non-empty>')[0]` always has
                        // a first element, so `.at(0)` would only add a spurious `| undefined`.
                        // Literal `0` only — a resolved-to-0 expression may be a mutated const.
                        if (isLiteral(indexNode, 0) && isFirstSplitElementAlwaysPresent(node.object)) {
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
                            if (indexNode.type === 'BinaryExpression'
                                && indexNode.operator === '-'
                                && indexNode.left === lengthNode
                                && indexNode.right.type === 'Literal'
                                && /^\d+$/.test(indexNode.right.raw)) {
                                const numberNode = indexNode.right;
                                const tokenBefore = sourceCode.getTokenBefore(numberNode);
                                if (tokenBefore?.type === 'Punctuator'
                                    && tokenBefore.value === '-'
                                    && /^\s+$/.test(sourceCode.text.slice(tokenBefore.range.at(1), numberNode.range.at(0)))) {
                                    yield fixer.removeRange([tokenBefore.range.at(1), numberNode.range.at(0),]);
                                }
                            }
                            const isOptional = node.optional;
                            const openingBracketToken = sourceCode.getTokenBefore(indexNode, isOpeningBracketToken);
                            yield fixer.replaceText(openingBracketToken, `${isOptional
                                ? ''
                                : '.'}at(`);
                            const closingBracketToken = sourceCode.getTokenAfter(indexNode, isClosingBracketToken);
                            yield fixer.replaceText(closingBracketToken, ')');
                        },
                    });
                },
                CallExpression(node) {
                    // Each check is mutually exclusive by method/shape; run in order and
                    // stop after the first that reports (mirrors unicorn's separate
                    // `context.on('CallExpression', …)` listeners, each of which returns
                    // early).
                    if (checkSplitAt(node)) {
                        return;
                    }
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
                description: 'Prefer `.at(…)` method for index access and `String#charAt()`, but allow `split(non-empty)[0]` (first element always present).',
            },
            fixable: 'code',
            hasSuggestions: true,
            messages: {
                negativeIndex: 'Prefer `.at(…)` over `[….length - index]`.',
                index: 'Prefer `.at(…)` over index access.',
                stringCharAtNegative: 'Prefer `String#at(…)` over `String#charAt(….length - index)`.',
                stringCharAt: 'Prefer `String#at(…)` over `String#charAt(…)`.',
                slice: 'Prefer `.at(…)` over the first element from `.slice(…)`.',
                splitIndexAccess: 'Prefer `[0]` over `.at(0)`: `String#split(…)` with a non-empty separator always has a first element, so `[0]` is `string`, not `string | undefined`.',
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
