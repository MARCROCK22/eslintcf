/* eslint-disable marcrock/prefer-at, @typescript-eslint/no-unnecessary-condition, no-cond-assign -- AST-traversal helpers vendored/forked from eslint-plugin-unicorn: bracket index access into AST tuples is intentional (`.at()` would widen to `T | undefined` and break `tsc`), the defensive conditionals are faithful to unicorn's originals, and the `while (parentheses = …)` walk is a direct port of unicorn's iterate-surrounding-parentheses. */
/*
Vendored helpers for the forked `prefer-at` rule.

These are faithful TypeScript ports of the internal helpers used by
eslint-plugin-unicorn's `rules/prefer-at.js`. They live here (rather than being
imported from the unicorn package) because unicorn's `package.json` `exports`
field blocks deep subpath imports — so the rule cannot `import` them and must
own them.

Sources (eslint-plugin-unicorn `rules/`):
  - utils/is-same-reference.js
  - utils/is-left-hand-side.js
  - utils/parentheses/{parentheses,iterate-surrounding-parentheses,get-parent-syntax-opening-parenthesis}.js
  - utils/is-node-matches.js
  - utils/needs-semicolon.js
  - utils/should-add-parentheses-to-member-expression-object.js
  - utils/is-new-expression-with-parentheses.js
  - utils/numeric.js
  - shared/negative-index.js
  - fix/{replace-member-expression-property,remove-method-call}.js
  - ast/{literal,call-or-new-expression,is-method-call,is-member-expression}.js

Deviation from unicorn: unicorn's helpers call `context.sourceCode.getRange(node)`
(an ESLint 9.6+ API not present in the SourceCode type shipped with this
project's `@typescript-eslint/utils`). TSESTree nodes and tokens always expose a
`.range` tuple, so these ports read `node.range` directly — behaviorally
identical. Helper params are typed with the TSESTree / TSESLint types that
typescript-eslint's own rules use.
*/

import type { TSESLint, TSESTree, } from '@typescript-eslint/utils';

import { ASTUtils, } from '@typescript-eslint/utils';

const {
    getStaticValue,
    isOpeningParenToken,
    isClosingParenToken,
} = ASTUtils;

// Minimal shape of the bits of the rule context the helpers touch.
export interface HelperContext {
    sourceCode: Readonly<TSESLint.SourceCode>;
}

const getRange = (nodeOrToken: TSESTree.Token | TSESTree.Node): TSESTree.Range => nodeOrToken.range;

// --- ast/literal.js ----------------------------------------------------------

export function isLiteral(node: TSESTree.Node | undefined | null, value: unknown): node is TSESTree.Literal {
    if (node?.type !== 'Literal') {
        return false;
    }
    return node.value === value;
}

export const isNumericLiteral = (node: TSESTree.Node): node is TSESTree.NumberLiteral => node.type === 'Literal' && typeof node.value === 'number';

export const isBigIntLiteral = (node: TSESTree.Node): node is TSESTree.BigIntLiteral => node.type === 'Literal' && 'bigint' in node && Boolean(node.bigint);

// --- utils/numeric.js (only what's needed) -----------------------------------

const DECIMAL_INTEGER_PATTERN = /^(?:0|0[0-7]*[89]\d*|[1-9](?:_?\d)*)$/u;
const isDecimalInteger = (text: string): boolean => DECIMAL_INTEGER_PATTERN.test(text);
export const isDecimalIntegerNode = (node: TSESTree.Node): boolean => isNumericLiteral(node) && isDecimalInteger(node.raw);

// --- ast/call-or-new-expression.js -------------------------------------------

interface CallOrNewOptions {
    name?: string;
    names?: readonly string[];
    argumentsLength?: number;
    minimumArguments?: number;
    maximumArguments?: number;
    allowSpreadElement?: boolean;
    optional?: boolean;
}

type CallOrNewOptionsArgument = readonly string[] | CallOrNewOptions | string;

function normalizeCallOrNewOptions(options: CallOrNewOptionsArgument | undefined): CallOrNewOptions {
    if (typeof options === 'string') {
        return { names: [options,], };
    }

    if (Array.isArray(options)) {
        return { names: options, };
    }

    return (options ?? {}) as CallOrNewOptions;
}

function createCallOrNew(
    node: TSESTree.Node,
    options: CallOrNewOptionsArgument | undefined,
    types: readonly string[]
): boolean {
    if (!types.includes(node.type)) {
        return false;
    }

    const callOrNewNode = node as TSESTree.CallExpression | TSESTree.NewExpression;
    // `NewExpression` has no `optional`; treat as `undefined` (matches runtime,
    // and the "can be `undefined` in some parsers" handling below).
    const nodeOptional = 'optional' in callOrNewNode
        ? callOrNewNode.optional
        : undefined;

    const normalizedOptions = {
        minimumArguments: 0,
        maximumArguments: Number.POSITIVE_INFINITY,
        allowSpreadElement: false,
        ...normalizeCallOrNewOptions(options),
    };
    const {
        name,
        argumentsLength,
        minimumArguments,
        maximumArguments,
        allowSpreadElement,
        optional,
    } = normalizedOptions;
    let { names, } = normalizedOptions;

    if (name) {
        names = [name,];
    }

    if (
        optional === true && nodeOptional !== optional
        ||
        optional === false
        // `node.optional` can be `undefined` in some parsers
        && nodeOptional

    ) {
        return false;
    }

    if (typeof argumentsLength === 'number' && callOrNewNode.arguments.length !== argumentsLength) {
        return false;
    }

    if (minimumArguments !== 0 && callOrNewNode.arguments.length < minimumArguments) {
        return false;
    }

    if (Number.isFinite(maximumArguments) && callOrNewNode.arguments.length > maximumArguments) {
        return false;
    }

    if (!allowSpreadElement) {
        const maximumArgumentsLength = Number.isFinite(maximumArguments)
            ? maximumArguments
            : argumentsLength;
        if (
            typeof maximumArgumentsLength === 'number'
            && callOrNewNode.arguments.some((argumentNode, index) => argumentNode.type === 'SpreadElement'
                && index < maximumArgumentsLength)
        ) {
            return false;
        }
    }

    if (
        Array.isArray(names)
        && names.length > 0
        && (
            callOrNewNode.callee.type !== 'Identifier'
            || !names.includes(callOrNewNode.callee.name)
        )
    ) {
        return false;
    }

    return true;
}

export const isCallExpression = (node: TSESTree.Node | undefined | null, options?: CallOrNewOptionsArgument): node is TSESTree.CallExpression => Boolean(node) && createCallOrNew(node!, options, ['CallExpression',]);

// --- ast/is-member-expression.js ---------------------------------------------

interface MemberExpressionOptions {
    property?: string;
    properties?: readonly string[];
    object?: string;
    objects?: readonly string[];
    optional?: boolean;
    computed?: boolean;
}

type MemberExpressionOptionsArgument = MemberExpressionOptions | readonly string[] | string;

function normalizeMemberExpressionOptions(options: MemberExpressionOptionsArgument | undefined): MemberExpressionOptions {
    if (typeof options === 'string') {
        return { properties: [options,], };
    }

    if (Array.isArray(options)) {
        return { properties: options, };
    }

    return (options ?? {}) as MemberExpressionOptions;
}

export function isMemberExpression(node: TSESTree.Node | undefined | null, options?: MemberExpressionOptionsArgument): node is TSESTree.MemberExpression {
    if (node?.type !== 'MemberExpression') {
        return false;
    }

    const normalizedOptions: MemberExpressionOptions = {
        property: '',
        properties: [],
        object: '',
        ...normalizeMemberExpressionOptions(options),
    };
    const {
        property,
        object,
        optional,
    } = normalizedOptions;
    let {
        properties,
        objects,
        computed,
    } = normalizedOptions;

    if (property) {
        properties = [property,];
    }

    if (object) {
        objects = [object,];
    }

    if (
        optional === true && node.optional !== optional
        ||
        optional === false
        // `node.optional` can be `undefined` in some parsers
        && node.optional

    ) {
        return false;
    }

    if (
        Array.isArray(properties)
        && properties.length > 0
    ) {
        if (
            node.property.type !== 'Identifier'
            || !properties.includes(node.property.name)
        ) {
            return false;
        }

        computed ??= false;
    }

    if (
        computed === true && node.computed !== computed
        ||
        computed === false
        // `node.computed` can be `undefined` in some parsers
        && node.computed

    ) {
        return false;
    }

    if (
        Array.isArray(objects)
        && objects.length > 0
        && (
            node.object.type !== 'Identifier'
            || !objects.includes(node.object.name)
        )
    ) {
        return false;
    }

    return true;
}

// --- ast/is-method-call.js ---------------------------------------------------

interface MethodCallOptions {
    method?: string;
    methods?: readonly string[];
    object?: string;
    objects?: readonly string[];
    argumentsLength?: number;
    minimumArguments?: number;
    maximumArguments?: number;
    allowSpreadElement?: boolean;
    optionalCall?: boolean;
    optionalMember?: boolean;
    computed?: boolean;
}

type MethodCallOptionsArgument = readonly string[] | MethodCallOptions | string;

function normalizeMethodCallOptions(options: MethodCallOptionsArgument | undefined): MethodCallOptions {
    if (typeof options === 'string') {
        return { methods: [options,], };
    }

    if (Array.isArray(options)) {
        return { methods: options, };
    }

    return (options ?? {}) as MethodCallOptions;
}

export function isMethodCall(node: TSESTree.Node | undefined | null, options?: MethodCallOptionsArgument): node is TSESTree.CallExpression {
    const normalizedOptions = normalizeMethodCallOptions(options);

    const {
        optionalCall,
        optionalMember,
        method,
        methods,
    }: MethodCallOptions = {
        method: '',
        methods: [],
        ...normalizedOptions,
    };

    return (
        isCallExpression(node, {
            argumentsLength: normalizedOptions.argumentsLength,
            minimumArguments: normalizedOptions.minimumArguments,
            maximumArguments: normalizedOptions.maximumArguments,
            allowSpreadElement: normalizedOptions.allowSpreadElement,
            optional: optionalCall,
        })
        && isMemberExpression(node.callee, {
            object: normalizedOptions.object,
            objects: normalizedOptions.objects,
            computed: normalizedOptions.computed,
            property: method,
            properties: methods,
            optional: optionalMember,
        })
    );
}

// --- utils/is-same-reference.js ----------------------------------------------

function getStaticPropertyName(node: TSESTree.Node): undefined | string {
    let property: TSESTree.Node | undefined;
    let computed = false;
    switch (node.type) {
        case 'MemberExpression': {
            property = node.property;
            computed = node.computed;
            break;
        }
        case 'ChainExpression': {
            return getStaticPropertyName(node.expression);
        }
        case 'Property':
        case 'MethodDefinition': {
            property = node.key;
            computed = node.computed;
            break;
        }
        // No default
    }
    if (property) {
        if (property.type === 'Identifier' && !computed) {
            return property.name;
        }
        const staticResult = getStaticValue(property);
        if (!staticResult) {
            return undefined;
        }
        return String(staticResult.value);
    }
    return undefined;
}

function equalLiteralValue(left: TSESTree.Literal, right: TSESTree.Literal): boolean {
    const leftRegex = 'regex' in left
        ? left.regex
        : undefined;
    const rightRegex = 'regex' in right
        ? right.regex
        : undefined;
    if (leftRegex || rightRegex) {
        return Boolean(
            leftRegex
            && leftRegex.pattern === rightRegex?.pattern
            && leftRegex.flags === rightRegex.flags
        );
    }
    const leftBigint = 'bigint' in left
        ? left.bigint
        : undefined;
    const rightBigint = 'bigint' in right
        ? right.bigint
        : undefined;
    if (leftBigint || rightBigint) {
        return leftBigint === rightBigint;
    }
    return left.value === right.value;
}

function unwrapNode(node: TSESTree.Node): TSESTree.Node {
    if (
        node.type === 'ChainExpression'
        || node.type === 'TSAsExpression'
        || node.type === 'TSTypeAssertion'
        || node.type === 'TSNonNullExpression'
    ) {
        return unwrapNode(node.expression);
    }
    return node;
}

export function isSameReference(leftNode: TSESTree.Node, rightNode: TSESTree.Node): boolean {
    const left = unwrapNode(leftNode);
    const right = unwrapNode(rightNode);
    if (left.type !== right.type) {
        return false;
    }
    switch (left.type) {
        case 'Super':
        case 'ThisExpression': {
            return true;
        }
        case 'Identifier':
        case 'PrivateIdentifier': {
            return left.name === (right as TSESTree.PrivateIdentifier | TSESTree.Identifier).name;
        }
        case 'Literal': {
            return equalLiteralValue(left, right as TSESTree.Literal);
        }
        case 'MemberExpression': {
            const memberRight = right as TSESTree.MemberExpression;
            const nameA = getStaticPropertyName(left);
            if (nameA !== undefined) {
                return isSameReference(left.object, memberRight.object) && nameA === getStaticPropertyName(memberRight);
            }
            return left.computed === memberRight.computed
                && isSameReference(left.object, memberRight.object)
                && isSameReference(left.property, memberRight.property);
        }
        default: {
            return false;
        }
    }
}

// --- shared/negative-index.js ------------------------------------------------

const isLiteralPositiveNumber = (node: TSESTree.Node): boolean => isNumericLiteral(node) && node.value > 0;
const isLengthMemberExpression = (node: TSESTree.Node): node is TSESTree.MemberExpression => node.type === 'MemberExpression'
    && !node.computed
    && !node.optional
    && node.property.type === 'Identifier'
    && node.property.name === 'length';

export function getNegativeIndexLengthNode(node: TSESTree.Node | undefined | null, objectNode: TSESTree.Node): TSESTree.Node | undefined {
    if (!node) {
        return undefined;
    }
    if (node.type !== 'BinaryExpression' || node.operator !== '-' || !isLiteralPositiveNumber(node.right)) {
        return undefined;
    }
    const { left, } = node;
    if (isLengthMemberExpression(left) && isSameReference(left.object, objectNode)) {
        return left;
    }
    // Nested BinaryExpression
    return getNegativeIndexLengthNode(left, objectNode);
}

export function removeLengthNode(node: TSESTree.Node, fixer: TSESLint.RuleFixer, context: HelperContext): TSESLint.RuleFix {
    const [start, end,] = getParenthesizedRange(node, context);
    return fixer.removeRange([
        start,
        end + /\S|$/.exec(context.sourceCode.text.slice(end))!.index,
    ]);
}

// --- utils/is-left-hand-side.js ----------------------------------------------

export const isLeftHandSide = (node: TSESTree.Node): boolean => {
    // These rule paths only run on nodes that always have a parent.
    const parent = node.parent!;
    return (parent.type === 'AssignmentExpression' || parent.type === 'AssignmentPattern') && parent.left === node
        || parent.type === 'UpdateExpression' && parent.argument === node
        || parent.type === 'ArrayPattern' && parent.elements.includes(node as TSESTree.DestructuringPattern)
        ||
        parent.type === 'Property'
        && parent.value === node
        && parent.parent.type === 'ObjectPattern'
        && parent.parent.properties.includes(parent)

        || parent.type === 'UnaryExpression' && parent.operator === 'delete' && parent.argument === node;
};

// --- utils/parentheses/get-parent-syntax-opening-parenthesis.js --------------

function getParentSyntaxOpeningParenthesis(node: TSESTree.Node, context: HelperContext): TSESTree.Token | undefined | null {
    // Only reached for nodes that have a parent (callers guard on `node.parent`).
    const parent = node.parent!;

    switch (parent.type) {
        case 'CallExpression':
        case 'NewExpression': {
            if (parent.arguments.length === 1 && parent.arguments.at(0) === node) {
                return context.sourceCode.getTokenAfter(
                    parent.typeArguments ?? parent.callee,
                    isOpeningParenToken
                );
            }
            return undefined;
        }

        case 'DoWhileStatement': {
            if (parent.test === node) {
                return context.sourceCode.getTokenAfter(
                    parent.body,
                    isOpeningParenToken
                );
            }
            return undefined;
        }

        case 'IfStatement':
        case 'WhileStatement': {
            if (parent.test === node) {
                return context.sourceCode.getFirstToken(parent, 1);
            }
            return undefined;
        }

        case 'ImportExpression': {
            if (parent.source === node) {
                return context.sourceCode.getFirstToken(parent, 1);
            }
            return undefined;
        }

        case 'SwitchStatement': {
            if (parent.discriminant === node) {
                return context.sourceCode.getFirstToken(parent, 1);
            }
            return undefined;
        }

        case 'WithStatement': {
            if (parent.object === node) {
                return context.sourceCode.getFirstToken(parent, 1);
            }
            return undefined;
        }

        default: {
            return undefined;
        }
    }
}

// --- utils/parentheses/iterate-surrounding-parentheses.js --------------------

type NodeOrToken = TSESTree.Token | TSESTree.Node;

function getSurroundingParentheses([head, tail,]: [NodeOrToken, NodeOrToken], context: HelperContext): [TSESTree.Token, TSESTree.Token] | undefined {
    const tokenBefore = context.sourceCode.getTokenBefore(head);

    if (!tokenBefore || !isOpeningParenToken(tokenBefore)) {
        return undefined;
    }

    const tokenAfter = context.sourceCode.getTokenAfter(tail);

    if (!tokenBefore || !tokenAfter || !isClosingParenToken(tokenAfter)) {
        return undefined;
    }

    return [tokenBefore, tokenAfter,];
}

const SYNTAX_OPENING_PARENTHESIS_INITIAL_VALUE = Symbol('SYNTAX_OPENING_PARENTHESIS_INITIAL_VALUE');

function* iterateSurroundingParentheses(node: TSESTree.Node | undefined | null, context: HelperContext): IterableIterator<[TSESTree.Token, TSESTree.Token]> {
    if (
        !node?.parent
        // `CatchClause.param` can't be parenthesized, example `try {} catch (error) {}`
        || node.parent.type === 'CatchClause' && node.parent.param === node
    ) {
        return;
    }

    let syntaxOpeningParenthesis: typeof SYNTAX_OPENING_PARENTHESIS_INITIAL_VALUE | TSESTree.Token | undefined | null = SYNTAX_OPENING_PARENTHESIS_INITIAL_VALUE;
    let current: [NodeOrToken, NodeOrToken] = [node, node,];
    let parentheses: [TSESTree.Token, TSESTree.Token] | undefined;
    while (parentheses = getSurroundingParentheses(current, context)) {
        const [openingParenthesisToken,] = parentheses;

        if (syntaxOpeningParenthesis === SYNTAX_OPENING_PARENTHESIS_INITIAL_VALUE) {
            syntaxOpeningParenthesis = getParentSyntaxOpeningParenthesis(node, context);
        }

        if (openingParenthesisToken === syntaxOpeningParenthesis) {
            break;
        }

        yield parentheses;
        current = parentheses;
    }
}

// --- utils/parentheses/parentheses.js ----------------------------------------

const parenthesesCache = new WeakMap<TSESTree.Node, TSESTree.Token[]>();

export function getParentheses(node: TSESTree.Node, context: HelperContext): TSESTree.Token[] {
    if (!node || !parenthesesCache.has(node)) {
        const parenthesis: TSESTree.Token[] = [];
        for (const [openingParenthesisToken, closingParenthesisToken,] of iterateSurroundingParentheses(node, context)) {
            parenthesis.unshift(openingParenthesisToken);
            parenthesis.push(closingParenthesisToken);
        }

        parenthesesCache.set(node, parenthesis);
    }

    return parenthesesCache.get(node)!;
}

export function getParenthesizedRange(node: TSESTree.Node, context: HelperContext): [number, number] {
    const parentheses = getParentheses(node, context);
    const [start,] = getRange(parentheses.at(0) ?? node);
    const [, end,] = getRange(parentheses.at(-1) ?? node);
    return [start, end,];
}

export function getParenthesizedText(node: TSESTree.Node, context: HelperContext): string {
    const [start, end,] = getParenthesizedRange(node, context);
    return context.sourceCode.text.slice(start, end);
}

export function isParenthesized(node: TSESTree.Node, context: HelperContext): boolean {
    if (parenthesesCache.has(node)) {
        return parenthesesCache.get(node)!.length > 0;
    }

    const isNotParenthesized = iterateSurroundingParentheses(node, context).next().done;

    if (isNotParenthesized) {
        parenthesesCache.set(node, []);
    }

    return !isNotParenthesized;
}

// --- utils/is-node-matches.js ------------------------------------------------

export function isNodeMatchesNameOrPath(node: TSESTree.Node, nameOrPath: string): boolean {
    const names = nameOrPath.trim().split('.');
    for (let index = names.length - 1; index >= 0; index--) {
        const name = names[index];
        if (!name) {
            return false;
        }

        if (index === 0) {
            return (
                node.type === 'Identifier' && node.name === name
                || name === 'this' && node.type === 'ThisExpression'
                || name === 'super' && node.type === 'Super'
            );
        }

        if (
            index === 1
            && node.type === 'MetaProperty'
            && node.property.type === 'Identifier'
            && node.property.name === name
        ) {
            node = node.meta;
            continue;
        }

        if (
            node.type === 'MemberExpression'
            && !node.optional
            && !node.computed
            && node.property.type === 'Identifier'
            && node.property.name === name
        ) {
            node = node.object;
            continue;
        }

        return false;
    }
    return false;
}

// --- utils/is-new-expression-with-parentheses.js -----------------------------

function isNewExpressionWithParentheses(node: TSESTree.NewExpression, context: HelperContext): boolean {
    if (node.arguments.length > 0) {
        return true;
    }

    const { sourceCode, } = context;
    const [penultimateToken, lastToken,] = sourceCode.getLastTokens(node, 2);
    // The expression should end with its own parens, for example, `new new Foo()` is not a new expression with parens.
    return isOpeningParenToken(penultimateToken)
        && isClosingParenToken(lastToken)
        && getRange(node.callee)[1] < getRange(node)[1];
}

// --- utils/should-add-parentheses-to-member-expression-object.js -------------

export function shouldAddParenthesesToMemberExpressionObject(node: TSESTree.Node, context: HelperContext): boolean {
    switch (node.type) {
        // This is not a full list. Some other nodes like `FunctionDeclaration` don't need parentheses,
        // but it's not possible to be in the place we are checking at this point.
        case 'Identifier':
        case 'MemberExpression':
        case 'CallExpression':
        case 'ChainExpression':
        case 'TemplateLiteral':
        case 'ThisExpression':
        case 'ArrayExpression':
        case 'FunctionExpression': {
            return false;
        }

        case 'NewExpression': {
            return !isNewExpressionWithParentheses(node, context);
        }

        case 'Literal': {
            if (isDecimalIntegerNode(node)) {
                return true;
            }
            return false;
        }

        default: {
            return true;
        }
    }
}

// --- utils/needs-semicolon.js ------------------------------------------------

// https://github.com/eslint/espree/blob/6b7d0b8100537dcd5c84a7fb17bbe28edcabe05d/lib/token-translator.js#L20
const tokenTypesNeedsSemicolon = new Set([
    'String',
    'RegularExpression',
    'Numeric',
    'Null',
    'Boolean',
]);

const charactersMightNeedsSemicolon = new Set([
    '+',
    '`',
    '/',
    '*',
    '[',
    '(',
    '.',
    ',',
    '-',
]);

export function needsSemicolon(tokenBefore: TSESTree.Token | null, context: HelperContext, code: string): boolean {
    if (
        code === ''
        || code && !charactersMightNeedsSemicolon.has(code.charAt(0))
    ) {
        return false;
    }

    if (!tokenBefore) {
        return false;
    }

    const { sourceCode, } = context;
    const { type, value, } = tokenBefore;
    const range = getRange(tokenBefore);
    // The token always sits inside a node, so a containing node is guaranteed.
    const lastBlockNode = sourceCode.getNodeByRangeIndex(range[0])!;
    if (type === 'Punctuator') {
        if (value === ';') {
            return false;
        }

        if (value === ']') {
            return true;
        }

        if (value === ')') {
            switch (lastBlockNode.type) {
                case 'IfStatement': {
                    if (sourceCode.getTokenBefore(lastBlockNode.consequent) === tokenBefore) {
                        return false;
                    }
                    break;
                }

                case 'ForStatement':
                case 'ForInStatement':
                case 'ForOfStatement':
                case 'WhileStatement':
                case 'DoWhileStatement':
                case 'WithStatement': {
                    if (lastBlockNode.body && sourceCode.getTokenBefore(lastBlockNode.body) === tokenBefore) {
                        return false;
                    }
                    break;
                }
                // No default
            }

            return true;
        }
    }

    if (tokenTypesNeedsSemicolon.has(type)) {
        return true;
    }

    if (type === 'Template') {
        return value.endsWith('`');
    }

    if (lastBlockNode.type === 'ObjectExpression') {
        return true;
    }

    if (type === 'Identifier') {
        // `for...of`
        if (value === 'of' && lastBlockNode.type === 'ForOfStatement') {
            return false;
        }

        // `await`
        if (value === 'await' && lastBlockNode.type === 'AwaitExpression') {
            return false;
        }

        return true;
    }

    return false;
}

// --- fix/replace-member-expression-property.js -------------------------------

export function replaceMemberExpressionProperty(fixer: TSESLint.RuleFixer, memberExpression: TSESTree.MemberExpression, context: HelperContext, text: string): TSESLint.RuleFix {
    const [, start,] = getParenthesizedRange(memberExpression.object, context);
    const [, end,] = getRange(memberExpression);
    return fixer.replaceTextRange([start, end,], text);
}

export const removeMemberExpressionProperty = (fixer: TSESLint.RuleFixer, memberExpression: TSESTree.MemberExpression, context: HelperContext): TSESLint.RuleFix => replaceMemberExpressionProperty(fixer, memberExpression, context, '');

// --- fix/remove-method-call.js -----------------------------------------------

export function* removeMethodCall(fixer: TSESLint.RuleFixer, callExpression: TSESTree.CallExpression, context: HelperContext): IterableIterator<TSESLint.RuleFix> {
    const memberExpression = callExpression.callee as TSESTree.MemberExpression;

    // `(( (( foo )).bar ))()`
    //              ^^^^
    yield removeMemberExpressionProperty(fixer, memberExpression, context);

    // `(( (( foo )).bar ))()`
    //                     ^^
    const [, start,] = getParenthesizedRange(memberExpression, context);
    const [, end,] = getRange(callExpression);

    yield fixer.removeRange([start, end,]);
}
