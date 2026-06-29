/* eslint-disable @typescript-eslint/no-unnecessary-condition -- AST-traversal code forked from eslint-plugin-unicorn: bracket index access into AST tuples/arguments is intentional (`.at()` would widen to `T | undefined` and break `tsc`), and the defensive type-guard conditionals are faithful to unicorn's originals. */
import type { TSESLint, TSESTree, } from '@typescript-eslint/utils';

import { ESLintUtils, ASTUtils, } from '@typescript-eslint/utils';
import * as ts from 'typescript';

const {
    isOpeningBracketToken,
    isClosingBracketToken,
    getStaticValue,
    findVariable,
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

Differences vs unicorn (the customizations), all in the INDEX-ACCESS path only,
exempting access whose element is PROVABLY present (so `.at()` would only widen
the type to `T | undefined` for nothing):

1. `<string>.split('<non-empty>')[0]` — a non-empty separator (resolved statically,
   so named constants count) always yields a non-empty array. When type info is
   available the receiver must be a string (a custom `split(): T[]` can return `[]`).
   Empty/dynamic separators, a `limit` argument, or any index other than `0` are
   still reported.

2. Statically-known length: an array literal, string/template literal, or `.concat`
   chain whose minimum length is known (`[1, 2, 3][2]`, `'ab'[0]`, `[0].concat(x)[0]`),
   read inline or through an effectively-const / non-escaping variable.

3. Type-aware (reads the TS type): `<tuple>[k]` / `<tuple>[<tuple>.length - k]` for a
   fixed-length tuple whose element is guaranteed to exist. A READONLY tuple is exempt
   outright; a MUTABLE tuple only when its receiver never escapes or mutates (like a
   plain array — it could otherwise be `pop`-ed). A plain `T[]` is NOT exempt.

4. Control-flow: `V[k]` when a condition that DOMINATES the access proves the length —
   an early-exit guard, a positive `if`/`else` branch, a ternary branch, an `&&`/`||`
   operand, or a `switch (V.length)` case, at any nesting depth, including via a boolean
   flag derived from `.length`. Length comparisons (`!V.length`, `V.length > m`,
   `>= m`, `=== c`, and their negations/compounds) work for arrays AND strings; a bare
   truthiness / `=== ''` guard works for STRINGS only (an empty array is truthy). The
   index may be a literal or a const that resolves to one. The receiver must hold the
   proven value at the access: a STRING must not be reassigned between the dominating
   guard and the access (a reassignment that is then re-guarded is fine — only guards
   after the last reassignment count); an ARRAY must never escape or mutate
   (`isNonEscapingArray` — `const` alone does not stop `pop`/`splice`/`length =`/
   `delete`/aliasing). Shadowed bindings, wrong-direction guards, reassigned-without-
   reguard receivers, and mutated/escaping receivers are still reported.

Residual unsoundness (inherent to intra-procedural + type-aware analysis, shared with
the type checker itself): inter-procedural aliasing (a callee mutating the receiver via
a caller-held alias), `as`-cast type lies, and sparse arrays (`new Array(n)`).

None of these exemptions is applied to the `charAt`/`slice`/get-last paths.

Helpers live in `./preferAt/helpers.ts`, vendored from unicorn internals because
unicorn's package `exports` blocks deep subpath imports.
*/

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

// --- tuple soundness (type-aware index exemption) -----------------------------

// The TupleType target of `type` (readonly OR mutable), or null when not a tuple
// reference. Readonly-ness is decided separately (`tupleTypeIsReadonly`): a readonly
// tuple is immutable; a mutable tuple's length is trusted only when the receiver also
// never escapes or mutates (`isNonEscapingArray`) — exactly like a plain array.
function tupleTargetOf(type: ts.Type): ts.TupleType | null {
    if (!(type.flags & ts.TypeFlags.Object)) {
        return null;
    }
    if (!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)) {
        return null;
    }
    const { target, } = type as ts.TypeReference;
    if (!(target.objectFlags & ts.ObjectFlags.Tuple)) {
        return null;
    }
    return target as ts.TupleType;
}

// Guaranteed minimum element count when EVERY constituent of `type` is a tuple,
// else null (for a union the guarantee is the smallest minLength). `minLength` is
// the count of leading required elements, so index `k` is always present iff
// `k < tupleMinLength`, and `<obj>[<obj>.length - k]` iff `tupleMinLength >= k`.
function tupleMinLength(type: ts.Type): number | null {
    let constituents: readonly ts.Type[] = [type,];
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

// Whether every constituent of `type` is a READONLY tuple (`as const` / `readonly
// [...]`) — immutable, so its length holds without escape analysis. A mutable tuple
// needs `isNonEscapingArray` instead.
function tupleTypeIsReadonly(type: ts.Type): boolean {
    let constituents: readonly ts.Type[] = [type,];
    if (type.isUnion()) {
        constituents = type.types;
    }
    return constituents.every((constituent) => tupleTargetOf(constituent)?.readonly === true);
}

// `k` from the `<obj>.length - k` negative-index pattern (positive integer), else null.
function negativeIndexK(indexNode: TSESTree.Node, lengthNode: TSESTree.Node): number | null {
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
const FUNCTION_NODE_TYPES = new Set([
    'FunctionExpression',
    'FunctionDeclaration',
    'ArrowFunctionExpression',
]);

// Comparison-operator transforms used to reason about length bounds.
// `negateOp`: the operator of the logical negation (`a < b` false ⇔ `a >= b`); null
// if `operator` is not a comparison. `swapOp`: the operator with operands swapped
// (`a < b` ⇔ `b > a`).
function negateOp(operator: string): string | null {
    switch (operator) {
        case '===': return '!==';
        case '!==': return '===';
        case '==': return '!=';
        case '!=': return '==';
        case '<': return '>=';
        case '>=': return '<';
        case '>': return '<=';
        case '<=': return '>';
        default: return null;
    }
}
function swapOp(operator: string): string {
    switch (operator) {
        case '<': return '>';
        case '>': return '<';
        case '<=': return '>=';
        case '>=': return '<=';
        default: return operator;
    }
}
// The lower bound on length implied by a TRUE comparison `length <operator> c`
// (`c` a non-negative integer); 0 means "no positive lower bound is proven".
function lenBoundFromCmp(operator: string, c: number): number {
    switch (operator) {
        case '===':
        case '==': return c;
        case '>': return c + 1;
        case '>=': return c;
        case '!==':
        case '!=': return c === 0
? 1
: 0;
        default: return 0;
    }
}

// Whether `statement` definitely transfers control out (no fall-through).
function definitelyExits(statement: TSESTree.Node): boolean {
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
function getStatementListBody(node: TSESTree.Node): readonly TSESTree.Node[] | null {
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

            // Parser services with type info, or null when unavailable (the rule still
            // works as a plain syntactic rule without a program).
            const getServices = () => {
                try {
                    const services = ESLintUtils.getParserServices(context, true);
                    if (!services.program) {
                        return null;
                    }
                    return services;
                } catch {
                    return null;
                }
            };

            // Static type of a node, or null when type info is unavailable.
            const getNodeType = (node: TSESTree.Node): ts.Type | null => {
                const services = getServices();
                if (services === null) {
                    return null;
                }
                return services.getTypeAtLocation(node);
            };

            // Whether every constituent of the object's type is an array, tuple, or
            // string — so `length > 0` truly implies index `0` exists (excludes e.g. a
            // function or a `{ length: number }` object that is not really indexable).
            const isLengthIndexableObject = (objectNode: TSESTree.Node): boolean => {
                const services = getServices();
                if (services === null) {
                    return false;
                }
                const checker = services.program.getTypeChecker();
                const type = services.getTypeAtLocation(objectNode);
                let parts: readonly ts.Type[] = [type,];
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
            const isStringObject = (objectNode: TSESTree.Node): boolean => {
                const type = getNodeType(objectNode);
                if (type === null) {
                    return false;
                }
                let parts: readonly ts.Type[] = [type,];
                if (type.isUnion()) {
                    parts = type.types;
                }
                return parts.every((part) => (part.flags & ts.TypeFlags.StringLike) !== 0);
            };

            // Whether `idNode` resolves to a variable that is never reassigned — so a
            // guarded non-emptiness still holds at the access. A write counts as a
            // reassignment UNLESS it is the declaration initializer; a parameter has no
            // initializer write, so a single `x = …` to a parameter is a reassignment.
            const isEffectivelyConst = (idNode: TSESTree.Identifier): boolean => {
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
            const isNonEscapingArray = (idNode: TSESTree.Identifier): boolean => {
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
                    // A method call on the receiver (`a.pop()` OR `a['pop']()`) may mutate it.
                    // Must precede the `member.computed` short-circuit, else a bracket-form
                    // mutator slips through as if it were a plain `a[i]` read.
                    if (outer.type === 'CallExpression' && outer.callee === member) {
                        return false;
                    }
                    if (member.computed) {
                        return true;
                    }
                    return member.property.type === 'Identifier' && member.property.name === 'length';
                });
            };

            // --- Proven lower bound on the receiver's length ----------------------
            // `len` is proven for ANY length-having receiver (from `.length` comparisons);
            // `str` is proven only for a STRING (from bare truthiness / `=== ''`, since an
            // empty array is still truthy). 0 = nothing proven.
            interface Bounds {
                len: number;
                str: number;
            }
            function mkB(len: number, str: number): Bounds {
                return {
                    len,
                    str,
                };
            }
            const ZERO = mkB(0, 0);
            const maxB = (a: Bounds, b: Bounds): Bounds => mkB(Math.max(a.len, b.len), Math.max(a.str, b.str));
            const intLiteralValue = (n: TSESTree.Node): number | null => {
                if (n.type === 'Literal' && typeof n.value === 'number' && Number.isInteger(n.value) && n.value >= 0) {
                    return n.value;
                }
                return null;
            };

            // Whether `node` references the SAME binding as the access receiver — guards
            // against a same-named variable shadowed in an inner scope while walking outward.
            const refsTarget = (node: TSESTree.Node, targetVar: TSESLint.Scope.Variable, name: string): boolean => node.type === 'Identifier'
                && node.name === name
                && findVariable(sourceCode.getScope(node), name) === targetVar;
            const isTargetLength = (node: TSESTree.Node, targetVar: TSESLint.Scope.Variable, name: string): boolean => node.type === 'MemberExpression'
                && !node.computed
                && node.property.type === 'Identifier'
                && node.property.name === 'length'
                && refsTarget(node.object, targetVar, name);

            // The initializer of an effectively-const variable, else null — lets a boolean
            // flag such as `const has = a.length > 0` be followed back to its test.
            const constInitializerOf = (idNode: TSESTree.Identifier): TSESTree.Expression | null => {
                if (!isEffectivelyConst(idNode)) {
                    return null;
                }
                const def = findVariable(sourceCode.getScope(idNode), idNode.name)?.defs.at(0);
                if (def?.node.type === 'VariableDeclarator' && def.node.init !== null) {
                    return def.node.init;
                }
                return null;
            };

            // Lower bounds on `targetVar.length` implied by `expr` being truthy/falsy.
            const conditionBounds = (expr: TSESTree.Node, targetVar: TSESLint.Scope.Variable, name: string, whenTruthy: boolean): Bounds => {
                if (expr.type === 'UnaryExpression' && expr.operator === '!') {
                    return conditionBounds(expr.argument, targetVar, name, !whenTruthy);
                }
                if (expr.type === 'LogicalExpression' && (expr.operator === '&&' || expr.operator === '||')) {
                    const a = conditionBounds(expr.left, targetVar, name, whenTruthy);
                    const b = conditionBounds(expr.right, targetVar, name, whenTruthy);
                    // `&&` truthy / `||` falsy ⇒ BOTH operands hold (take the stronger bound);
                    // otherwise only one is known to hold (take the weaker bound that survives).
                    const conjunction = expr.operator === '&&';
                    const bothHold = conjunction === whenTruthy;
                    let pick = Math.min;
                    if (bothHold) {
                        pick = Math.max;
                    }
                    return mkB(pick(a.len, b.len), pick(a.str, b.str));
                }
                if (expr.type === 'Identifier' && !refsTarget(expr, targetVar, name)) {
                    const init = constInitializerOf(expr);
                    if (init === null) {
                        return ZERO;
                    }
                    return conditionBounds(init, targetVar, name, whenTruthy);
                }
                if (isTargetLength(expr, targetVar, name)) {
                    if (whenTruthy) {
                        return mkB(1, 0);
                    }
                    return ZERO;
                }
                if (refsTarget(expr, targetVar, name)) {
                    if (whenTruthy) {
                        return mkB(0, 1);
                    }
                    return ZERO;
                }
                if (expr.type !== 'BinaryExpression') {
                    return ZERO;
                }
                let operator: string | null = expr.operator;
                if (!whenTruthy) {
                    operator = negateOp(operator);
                }
                if (operator === null) {
                    return ZERO;
                }
                if (isTargetLength(expr.left, targetVar, name)) {
                    const c = intLiteralValue(expr.right);
                    if (c === null) {
                        return ZERO;
                    }
                    return mkB(lenBoundFromCmp(operator, c), 0);
                }
                if (isTargetLength(expr.right, targetVar, name)) {
                    const c = intLiteralValue(expr.left);
                    if (c === null) {
                        return ZERO;
                    }
                    return mkB(lenBoundFromCmp(swapOp(operator), c), 0);
                }
                const isEmptyStr = (n: TSESTree.Node): boolean => n.type === 'Literal' && n.value === '';
                const onEmptyString = refsTarget(expr.left, targetVar, name) && isEmptyStr(expr.right)
                    || isEmptyStr(expr.left) && refsTarget(expr.right, targetVar, name);
                if (onEmptyString && (operator === '!==' || operator === '!=')) {
                    return mkB(0, 1);
                }
                return ZERO;
            };

            // Length lower bound from being inside a `case`/`default` of `switch (V.length)`,
            // requiring every preceding case to be an integer literal that exits (no fall-through).
            const switchBound = (switchCase: TSESTree.SwitchCase, targetVar: TSESLint.Scope.Variable, name: string): Bounds => {
                const sw = switchCase.parent;
                if (sw.type !== 'SwitchStatement' || !isTargetLength(sw.discriminant, targetVar, name)) {
                    return ZERO;
                }
                const excluded = new Set<number>();
                const myIndex = sw.cases.indexOf(switchCase);
                for (let i = 0; i < myIndex; i++) {
                    const clause = sw.cases[i];
                    if (clause.test === null) {
                        continue;
                    }
                    const value = intLiteralValue(clause.test);
                    const last = clause.consequent.at(-1);
                    if (value === null || last === undefined || !definitelyExits(last)) {
                        return ZERO;
                    }
                    excluded.add(value);
                }
                if (switchCase.test === null) {
                    let bound = 0;
                    while (excluded.has(bound)) {
                        bound++;
                    }
                    return mkB(bound, 0);
                }
                const value = intLiteralValue(switchCase.test);
                if (value === null) {
                    return ZERO;
                }
                return mkB(value, 0);
            };

            // Walk outward from the access, accumulating the strongest length lower bound
            // proven by every condition that DOMINATES it: early-exit guards (preceding
            // siblings), positive/`else` `if` branches, ternary branches, `&&`/`||` operands,
            // and `switch (V.length)` cases. Stops at a function boundary (a guard outside a
            // closure need not still hold when the closure runs) and at a `SequenceExpression`
            // (a comma could run a mutating call between the guard and the access). Only guards
            // positioned after `minGuardPos` count — a guard before the receiver's last
            // reassignment proved a now-stale value (pass -1 to count every guard).
            const provenLengthBound = (accessNode: TSESTree.Node, targetVar: TSESLint.Scope.Variable, name: string, minGuardPos: number): Bounds => {
                let best = ZERO;
                let node: TSESTree.Node = accessNode;
                let parent = node.parent;
                // `.parent` is `undefined` mid-tree but `null` at the Program root.
                while (parent !== undefined && parent !== null) {
                    if (FUNCTION_NODE_TYPES.has(parent.type) || parent.type === 'SequenceExpression') {
                        break;
                    }
                    const [parentStart,] = parent.range;
                    const guardLive = parentStart > minGuardPos;
                    if (parent.type === 'ConditionalExpression') {
                        if (guardLive && node === parent.consequent) {
                            best = maxB(best, conditionBounds(parent.test, targetVar, name, true));
                        } else if (guardLive && node === parent.alternate) {
                            best = maxB(best, conditionBounds(parent.test, targetVar, name, false));
                        }
                    } else if (parent.type === 'LogicalExpression') {
                        if (guardLive && node === parent.right) {
                            best = maxB(best, conditionBounds(parent.left, targetVar, name, parent.operator === '&&'));
                        }
                    } else if (parent.type === 'IfStatement') {
                        if (guardLive && node === parent.consequent) {
                            best = maxB(best, conditionBounds(parent.test, targetVar, name, true));
                        } else if (guardLive && node === parent.alternate) {
                            best = maxB(best, conditionBounds(parent.test, targetVar, name, false));
                        }
                    } else {
                        const body = getStatementListBody(parent);
                        if (body !== null) {
                            const index = body.indexOf(node);
                            for (let i = 0; i < index; i++) {
                                const sibling = body[i];
                                const [siblingStart,] = sibling.range;
                                if (sibling.type === 'IfStatement' && sibling.alternate === null && definitelyExits(sibling.consequent) && siblingStart > minGuardPos) {
                                    best = maxB(best, conditionBounds(sibling.test, targetVar, name, false));
                                }
                            }
                            if (parent.type === 'SwitchCase' && guardLive) {
                                best = maxB(best, switchBound(parent, targetVar, name));
                            }
                        }
                    }
                    node = parent;
                    parent = parent.parent;
                }
                return best;
            };

            // Statically-known minimum length of an expression's VALUE: array literals
            // (elements before any hole/spread), string/template literals, and `.concat`
            // chains; null when not statically determinable.
            const syntacticMinLength = (expr: TSESTree.Node): number | null => {
                if (expr.type === 'ArrayExpression') {
                    let count = 0;
                    for (const element of expr.elements) {
                        if (element === null || element.type === 'SpreadElement') {
                            break;
                        }
                        count++;
                    }
                    return count;
                }
                if (expr.type === 'Literal' && typeof expr.value === 'string') {
                    return expr.value.length;
                }
                if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0) {
                    return expr.quasis.at(0)?.value.cooked?.length ?? null;
                }
                if (expr.type === 'CallExpression'
                    && expr.callee.type === 'MemberExpression'
                    && !expr.callee.computed
                    && expr.callee.property.type === 'Identifier'
                    && expr.callee.property.name === 'concat') {
                    let total = syntacticMinLength(expr.callee.object) ?? 0;
                    for (const arg of expr.arguments) {
                        if (arg.type === 'SpreadElement') {
                            return null;
                        }
                        if (arg.type === 'ArrayExpression') {
                            total += syntacticMinLength(arg) ?? 0;
                        } else if (arg.type === 'Literal') {
                            total += 1;
                        }
                        // a non-literal arg may be an array (flattened, >= 0 elements) → adds 0
                    }
                    return total;
                }
                return null;
            };

            // Minimum length of `objectNode`'s value, following an effectively-const /
            // non-escaping variable back to its initializer; null when undeterminable.
            const staticMinLength = (objectNode: TSESTree.Node): number | null => {
                if (objectNode.type !== 'Identifier') {
                    return syntacticMinLength(objectNode);
                }
                const def = findVariable(sourceCode.getScope(objectNode), objectNode.name)?.defs.at(0);
                if (def?.node.type !== 'VariableDeclarator' || def.node.init === null) {
                    return null;
                }
                const min = syntacticMinLength(def.node.init);
                if (min === null) {
                    return null;
                }
                const { init, } = def.node;
                const isString = init.type === 'Literal' && typeof init.value === 'string' || init.type === 'TemplateLiteral';
                if (isString
? !isEffectivelyConst(objectNode)
: !isNonEscapingArray(objectNode)) {
                    return null;
                }
                return min;
            };

            // The end position of `variable`'s last reassignment that precedes `accessNode`,
            // or -1 if none — a guard before this no longer holds at the access (only a later
            // re-guard can re-establish the bound).
            const lastWriteEndBefore = (variable: TSESLint.Scope.Variable, accessNode: TSESTree.Node): number => {
                const [accessStart,] = accessNode.range;
                let maxEnd = -1;
                for (const reference of variable.references) {
                    const [, refEnd,] = reference.identifier.range;
                    if (reference.isWrite() && reference.init !== true && refEnd <= accessStart) {
                        maxEnd = Math.max(maxEnd, refEnd);
                    }
                }
                return maxEnd;
            };

            // Whether the accessed receiver's length is provably `>= need` (so the indexed
            // element is present): from a tuple type, a statically-known length, or a
            // dominating guard. The receiver must be immutable for the proof to hold at the
            // access — a readonly tuple, or a non-escaping receiver (string / array / mutable
            // tuple); a guard before a reassignment of the receiver is ignored.
            const guaranteedLengthAtLeast = (accessNode: TSESTree.MemberExpression, objectNode: TSESTree.Node, need: number): boolean => {
                if (need <= 0) {
                    return true;
                }
                const objectType = getNodeType(objectNode);
                if (objectType !== null) {
                    const minLength = tupleMinLength(objectType);
                    if (minLength !== null && minLength >= need) {
                        // A readonly tuple is immutable; a mutable one is trusted only when
                        // the receiver never escapes or mutates (exactly like a plain array).
                        if (tupleTypeIsReadonly(objectType)) {
                            return true;
                        }
                        if (objectNode.type === 'Identifier' && isNonEscapingArray(objectNode)) {
                            return true;
                        }
                    }
                }
                const staticLen = staticMinLength(objectNode);
                if (staticLen !== null && staticLen >= need) {
                    return true;
                }
                if (objectNode.type === 'Identifier') {
                    const targetVar = findVariable(sourceCode.getScope(objectNode), objectNode.name);
                    if (targetVar !== null) {
                        // Only guards positioned after the receiver's last reassignment hold.
                        const bounds = provenLengthBound(accessNode, targetVar, objectNode.name, lastWriteEndBefore(targetVar, accessNode));
                        if (bounds.len >= need && isLengthIndexableObject(objectNode) && isNonEscapingArray(objectNode)) {
                            return true;
                        }
                        if (Math.max(bounds.len, bounds.str) >= need && isStringObject(objectNode)) {
                            return true;
                        }
                    }
                }
                return false;
            };

            // `<expr>.split('<non-empty>')[0]` — the first element is always present.
            // Separator resolved statically so named constants count, not just magic
            // strings; requires exactly one argument (no `limit`) and a non-empty string.
            // Syntactic (no type info): assumes a `String`/`Array` receiver — a custom
            // `.split()` returning a possibly-empty non-array is out of scope.
            const isFirstSplitElementAlwaysPresent = (objectNode: TSESTree.Node): boolean => {
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
                if (separator === null || typeof separator.value !== 'string' || separator.value.length === 0) {
                    return false;
                }
                // The "element 0 always present" guarantee is `String.prototype.split`'s — a
                // custom `split(): T[]` or an `any` receiver can return `[]`. When type info is
                // available, require a string receiver; otherwise stay syntactic (best effort).
                const receiver = (objectNode.callee as TSESTree.MemberExpression).object;
                if (getNodeType(receiver) !== null) {
                    return isStringObject(receiver);
                }
                return true;
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

            // INVERSE of the index path: `<expr>.split('<non-empty>').at(0)` always has
            // a first element, and `.at(0)` is `T | undefined` while `[0]` is `T` — so
            // here prefer (and autofix to) index access.
            const checkSplitAt = (node: TSESTree.CallExpression): boolean => {
                if (!isMethodCall(node, {
                    method: 'at',
                    argumentsLength: 1,
                    optionalCall: false,
                    optionalMember: false,
                })) {
                    return false;
                }
                const callee = node.callee as TSESTree.MemberExpression;
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
                    fix(fixer: TSESLint.RuleFixer): TSESLint.RuleFix {
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
                        // `<expr>[<expr>.length - k]` indexes a present element when the
                        // receiver's guaranteed length is >= k (so `length - k >= 0`).
                        const k = negativeIndexK(indexNode, lengthNode);
                        if (k !== null && guaranteedLengthAtLeast(node, node.object, k)) {
                            return;
                        }
                    } else {
                        if (!checkAllIndexAccess) {
                            return;
                        }
                        // Only if we are sure it's a non-negative integer (a literal, or a
                        // const that resolves to one — e.g. `const FIRST = 0; a[FIRST]`).
                        const staticValue = getStaticValue(indexNode, sourceCode.getScope(indexNode));
                        if (!staticValue || !Number.isInteger(staticValue.value) || (staticValue.value as number) < 0) {
                            return;
                        }
                        const k = staticValue.value as number;
                        // `<string>.split('<non-empty>')[0]` always has a first element.
                        if (k === 0 && isFirstSplitElementAlwaysPresent(node.object)) {
                            return;
                        }
                        // `<expr>[k]` is present when the receiver's length is provably > k
                        // (readonly tuple, statically-known length, or a dominating guard), so
                        // `.at(k)` would only widen the type to `T | undefined`.
                        if (guaranteedLengthAtLeast(node, node.object, k + 1)) {
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
