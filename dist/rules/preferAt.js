import { ESLintUtils, ASTUtils, } from '@typescript-eslint/utils';
import * as ts from 'typescript';
const { isOpeningBracketToken, isClosingBracketToken, getStaticValue, findVariable, } = ASTUtils;
import { shouldAddParenthesesToMemberExpressionObject, removeMemberExpressionProperty, getNegativeIndexLengthNode, isNodeMatchesNameOrPath, getParenthesizedRange, getParenthesizedText, isMemberExpression, removeLengthNode, isCallExpression, removeMethodCall, isParenthesized, isLeftHandSide, needsSemicolon, isMethodCall, isLiteral, } from './preferAt/helpers.js';
/*
Forked from eslint-plugin-unicorn `prefer-at` (rules/prefer-at.js) — a complete
port of all four detection paths (index access, `String#charAt`, the first
element of `.slice(-n)` / `.shift()` / `.pop()`, and get-last functions such as
`_.last`) WITH autofix and suggestions, faithful to unicorn.

Differences vs unicorn (the customizations), both in the INDEX-ACCESS path only,
exempting access whose element is PROVABLY present (so `.at()` would only widen
the type to `T | undefined` for nothing):

1. `<expr>.split('<non-empty>')[0]` — split with a non-empty separator (resolved
   statically, so named constants count) always yields a non-empty array. Empty/
   dynamic separators, a `limit` argument, or any index other than `0` are still
   reported.

2. Type-aware (reads the TS type): `<tuple>[k]` and `<tuple>[<tuple>.length - k]`
   when the receiver is a fixed-length TUPLE whose element is guaranteed to exist
   (`k < minLength` / `minLength >= k`). A plain `T[]` is NOT exempt (it can be
   empty). Degrades to no exemption when type info is unavailable.

3. Control-flow: `V[k]` when a preceding early-exit guard in the same block proves
   index k is present (exit via `return`/`throw`/`break`/`continue`): a length
   guard `if (!V.length)` / `if (V.length < m)` / `if (V.length <= n)` (for an
   array OR string), or — for a STRING only — a truthiness/empty guard `if (!V)` /
   `if (V === '')` (covers `k === 0`; an empty array is truthy so this is unsound
   for arrays). Requires `V` to be an effectively-const Identifier and a LITERAL
   index. A missing/insufficient guard, a reassignable `V`, or a wrong receiver
   type is still reported.

None of these exemptions is applied to the `charAt`/`slice`/get-last paths.

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
// --- tuple soundness (type-aware index exemption) -----------------------------
// The READONLY TupleType target of `type`, or null otherwise. Only readonly tuples
// are immutable: a mutable tuple can be `pop()`-ed (or be the result of an
// `as [T, T]` cast that lies about a shorter runtime array), so its static length is
// not a runtime guarantee. A readonly tuple (`as const` / `readonly [...]`) cannot be
// mutated, so its element types are a real guarantee.
function tupleTargetOf(type) {
    if (!(type.flags & ts.TypeFlags.Object)) {
        return null;
    }
    if (!(type.objectFlags & ts.ObjectFlags.Reference)) {
        return null;
    }
    const { target, } = type;
    if (!(target.objectFlags & ts.ObjectFlags.Tuple)) {
        return null;
    }
    const tuple = target;
    if (!tuple.readonly) {
        return null;
    }
    return tuple;
}
// Guaranteed minimum element count when EVERY constituent of `type` is a tuple,
// else null (for a union the guarantee is the smallest minLength). `minLength` is
// the count of leading required elements, so index `k` is always present iff
// `k < tupleMinLength`, and `<obj>[<obj>.length - k]` iff `tupleMinLength >= k`.
function tupleMinLength(type) {
    let constituents = [type,];
    if (type.isUnion()) {
        constituents = type.types;
    }
    let min = Number.POSITIVE_INFINITY;
    for (const constituent of constituents) {
        const target = tupleTargetOf(constituent);
        if (target === null) {
            return null;
        }
        min = Math.min(min, target.minLength);
    }
    if (!Number.isFinite(min)) {
        return null;
    }
    return min;
}
// `k` from the `<obj>.length - k` negative-index pattern (positive integer), else null.
function negativeIndexK(indexNode, lengthNode) {
    if (indexNode.type === 'BinaryExpression'
        && indexNode.operator === '-'
        && indexNode.left === lengthNode
        && indexNode.right.type === 'Literal'
        && typeof indexNode.right.value === 'number'
        && Number.isInteger(indexNode.right.value)
        && indexNode.right.value >= 1) {
        return indexNode.right.value;
    }
    return null;
}
// --- control-flow soundness (length-guard index exemption) --------------------
// What an early-exit guard `if (test) <exit>` proves about reaching the access
// (i.e. `test` was FALSE) for index `k`. Returns:
//   'length' — proves `<objectName>.length > k` (valid for arrays AND strings):
//       !V.length / V.length === 0 / 0 === V.length        -> length >= 1   -> k === 0
//       V.length < m / m > V.length   (m positive integer) -> length >= m   -> k <= m - 1
//       V.length <= n / n >= V.length (n non-negative int) -> length >= n+1 -> k <= n
//   'string' — proves V is a non-empty STRING (valid ONLY for strings, since an
//       empty array is truthy):  !V / V === '' / '' === V  ->  k === 0
//   null — not a recognized sufficient guard.
function guardCoversIndex(test, objectName, k) {
    const isLengthOf = (n) => n.type === 'MemberExpression'
        && !n.computed
        && n.object.type === 'Identifier'
        && n.object.name === objectName
        && n.property.type === 'Identifier'
        && n.property.name === 'length';
    const isObject = (n) => n.type === 'Identifier' && n.name === objectName;
    const intValue = (n) => {
        if (n.type === 'Literal' && typeof n.value === 'number' && Number.isInteger(n.value) && n.value >= 0) {
            return n.value;
        }
        return null;
    };
    if (test.type === 'UnaryExpression' && test.operator === '!') {
        if (k !== 0) {
            return null;
        }
        if (isLengthOf(test.argument)) {
            return 'length';
        }
        if (isObject(test.argument)) {
            return 'string';
        }
        return null;
    }
    if (test.type !== 'BinaryExpression') {
        return null;
    }
    const { operator, left, right, } = test;
    if (operator === '===' || operator === '==') {
        if (k !== 0) {
            return null;
        }
        if (isLengthOf(left) && isLiteral(right, 0) || isLiteral(left, 0) && isLengthOf(right)) {
            return 'length';
        }
        if (isObject(left) && isLiteral(right, '') || isLiteral(left, '') && isObject(right)) {
            return 'string';
        }
        return null;
    }
    if (operator === '<' && isLengthOf(left)) {
        const m = intValue(right);
        if (m !== null && k <= m - 1) {
            return 'length';
        }
        return null;
    }
    if (operator === '>' && isLengthOf(right)) {
        const m = intValue(left);
        if (m !== null && k <= m - 1) {
            return 'length';
        }
        return null;
    }
    if (operator === '<=' && isLengthOf(left)) {
        const n = intValue(right);
        if (n !== null && k <= n) {
            return 'length';
        }
        return null;
    }
    if (operator === '>=' && isLengthOf(right)) {
        const n = intValue(left);
        if (n !== null && k <= n) {
            return 'length';
        }
        return null;
    }
    return null;
}
// Whether `statement` definitely transfers control out (no fall-through).
function definitelyExits(statement) {
    if (statement.type === 'ReturnStatement'
        || statement.type === 'ThrowStatement'
        || statement.type === 'BreakStatement'
        || statement.type === 'ContinueStatement') {
        return true;
    }
    if (statement.type === 'BlockStatement') {
        const last = statement.body.at(-1);
        return last !== undefined && definitelyExits(last);
    }
    return false;
}
// The statement-list a node holds (block / program / static block / switch case), else null.
function getStatementListBody(node) {
    if (node.type === 'BlockStatement' || node.type === 'StaticBlock' || node.type === 'Program') {
        return node.body;
    }
    if (node.type === 'SwitchCase') {
        return node.consequent;
    }
    return null;
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
            // Parser services with type info, or null when unavailable (the rule still
            // works as a plain syntactic rule without a program).
            const getServices = () => {
                try {
                    const services = ESLintUtils.getParserServices(context, true);
                    if (!services.program) {
                        return null;
                    }
                    return services;
                }
                catch {
                    return null;
                }
            };
            // Static type of a node, or null when type info is unavailable.
            const getNodeType = (node) => {
                const services = getServices();
                if (services === null) {
                    return null;
                }
                return services.getTypeAtLocation(node);
            };
            // Whether every constituent of the object's type is an array, tuple, or
            // string — so `length > 0` truly implies index `0` exists (excludes e.g. a
            // function or a `{ length: number }` object that is not really indexable).
            const isLengthIndexableObject = (objectNode) => {
                const services = getServices();
                if (services === null) {
                    return false;
                }
                const checker = services.program.getTypeChecker();
                const type = services.getTypeAtLocation(objectNode);
                let parts = [type,];
                if (type.isUnion()) {
                    parts = type.types;
                }
                return parts.every((part) => (part.flags & ts.TypeFlags.StringLike) !== 0
                    || checker.isArrayType(part)
                    || checker.isTupleType(part));
            };
            // Whether every constituent of the object's type is a string (the `!V` /
            // `V === ''` truthiness guard only proves non-empty for strings — an empty
            // array is truthy).
            const isStringObject = (objectNode) => {
                const type = getNodeType(objectNode);
                if (type === null) {
                    return false;
                }
                let parts = [type,];
                if (type.isUnion()) {
                    parts = type.types;
                }
                return parts.every((part) => (part.flags & ts.TypeFlags.StringLike) !== 0);
            };
            // Whether `idNode` resolves to a variable that is never reassigned — so a
            // guarded non-emptiness still holds at the access. A write counts as a
            // reassignment UNLESS it is the declaration initializer; a parameter has no
            // initializer write, so a single `x = …` to a parameter is a reassignment.
            const isEffectivelyConst = (idNode) => {
                const variable = findVariable(sourceCode.getScope(idNode), idNode.name);
                if (variable === null) {
                    return false;
                }
                return variable.references.every((reference) => !reference.isWrite() || reference.init === true);
            };
            // For a MUTABLE array receiver, `isEffectivelyConst` is not enough: `const`
            // blocks rebinding, not in-place mutation (`pop`/`shift`/`splice`/`length =`/
            // `delete`/alias/escape). Require that EVERY reference is a non-write `V.length`
            // or `V[index]` read — then it cannot be mutated, aliased, passed to a callee,
            // reassigned, or deleted-from between the guard and the access.
            const isNonEscapingArray = (idNode) => {
                const variable = findVariable(sourceCode.getScope(idNode), idNode.name);
                if (variable === null) {
                    return false;
                }
                return variable.references.every((reference) => {
                    if (reference.init === true) {
                        return true;
                    }
                    const member = reference.identifier.parent;
                    if (member.type !== 'MemberExpression' || member.object !== reference.identifier) {
                        return false;
                    }
                    const outer = member.parent;
                    if (outer.type === 'AssignmentExpression' && outer.left === member) {
                        return false;
                    }
                    if (outer.type === 'UpdateExpression' && outer.argument === member) {
                        return false;
                    }
                    if (outer.type === 'UnaryExpression' && outer.operator === 'delete' && outer.argument === member) {
                        return false;
                    }
                    if (member.computed) {
                        return true;
                    }
                    return member.property.type === 'Identifier' && member.property.name === 'length';
                });
            };
            // The kind of dominating early-exit guard (a preceding sibling in the same
            // block) that guarantees index `k` is present: `'length'` (array/string) or
            // `'string'` (string only), or null if there is none.
            const dominatingGuardKind = (accessNode, objectName, k) => {
                let statement = accessNode;
                while (statement.parent !== undefined) {
                    const body = getStatementListBody(statement.parent);
                    if (body !== null) {
                        const index = body.indexOf(statement);
                        for (let i = 0; i < index; i++) {
                            const sibling = body[i];
                            if (sibling.type === 'IfStatement'
                                && sibling.alternate === null
                                && definitelyExits(sibling.consequent)) {
                                const kind = guardCoversIndex(sibling.test, objectName, k);
                                if (kind !== null) {
                                    return kind;
                                }
                            }
                        }
                        // Same block only (a block cannot redeclare a const name → no shadowing).
                        return null;
                    }
                    statement = statement.parent;
                }
                return null;
            };
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
                    if (lengthNode) {
                        // Type-aware: `<tuple>[<tuple>.length - k]` indexes a present element
                        // when the tuple's guaranteed length is >= k (so `length - k >= 0`).
                        const k = negativeIndexK(indexNode, lengthNode);
                        if (k !== null) {
                            const objectType = getNodeType(node.object);
                            if (objectType !== null) {
                                const minLength = tupleMinLength(objectType);
                                if (minLength !== null && minLength >= k) {
                                    return;
                                }
                            }
                        }
                    }
                    else {
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
                        // Type-aware: `<tuple>[k]` is always present when `k` is within the
                        // tuple's required elements, so `.at(k)` would only widen to `T | undefined`.
                        // A plain `T[]` is NOT exempt (it can be empty).
                        const objectType = getNodeType(node.object);
                        if (objectType !== null) {
                            const minLength = tupleMinLength(objectType);
                            if (minLength !== null && staticValue.value < minLength) {
                                return;
                            }
                        }
                        // Control-flow: `if (V too short / empty) <exit>; … V[k]` — a
                        // dominating early-exit guard proves index k is present, so `.at(k)`
                        // would only widen to `T | undefined`. The index must be a literal (a
                        // resolved-const value could be mutated). A STRING receiver only needs
                        // to be never-reassigned (immutable); an ARRAY receiver must also never
                        // escape or mutate — `const` does not prevent `pop`/`splice`/`length =`/
                        // aliasing/`delete` (see isNonEscapingArray).
                        if (indexNode.type === 'Literal'
                            && typeof indexNode.value === 'number'
                            && Number.isInteger(indexNode.value)
                            && indexNode.value >= 0
                            && node.object.type === 'Identifier') {
                            const guardKind = dominatingGuardKind(node, node.object.name, indexNode.value);
                            // String receiver: immutable, so never-reassigned is enough.
                            if ((guardKind === 'string' || guardKind === 'length')
                                && isStringObject(node.object)
                                && isEffectivelyConst(node.object)) {
                                return;
                            }
                            // Array receiver: mutable, so it must never escape or mutate.
                            if (guardKind === 'length'
                                && isLengthIndexableObject(node.object)
                                && isNonEscapingArray(node.object)) {
                                return;
                            }
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
                description: 'Prefer `.at(…)` for index access and `String#charAt()`, but allow provably-present index access — `split(non-empty)[0]` and fixed-tuple `[k]` — where `.at()` would only add `| undefined`.',
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
