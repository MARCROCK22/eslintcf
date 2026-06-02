import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
export interface HelperContext {
    sourceCode: Readonly<TSESLint.SourceCode>;
}
export declare function isLiteral(node: TSESTree.Node | undefined | null, value: unknown): node is TSESTree.Literal;
export declare const isNumericLiteral: (node: TSESTree.Node) => node is TSESTree.NumberLiteral;
export declare const isBigIntLiteral: (node: TSESTree.Node) => node is TSESTree.BigIntLiteral;
export declare const isDecimalIntegerNode: (node: TSESTree.Node) => boolean;
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
export declare const isCallExpression: (node: TSESTree.Node | undefined | null, options?: CallOrNewOptionsArgument) => node is TSESTree.CallExpression;
interface MemberExpressionOptions {
    property?: string;
    properties?: readonly string[];
    object?: string;
    objects?: readonly string[];
    optional?: boolean;
    computed?: boolean;
}
type MemberExpressionOptionsArgument = MemberExpressionOptions | readonly string[] | string;
export declare function isMemberExpression(node: TSESTree.Node | undefined | null, options?: MemberExpressionOptionsArgument): node is TSESTree.MemberExpression;
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
export declare function isMethodCall(node: TSESTree.Node | undefined | null, options?: MethodCallOptionsArgument): node is TSESTree.CallExpression;
export declare function isSameReference(leftNode: TSESTree.Node, rightNode: TSESTree.Node): boolean;
export declare function getNegativeIndexLengthNode(node: TSESTree.Node | undefined | null, objectNode: TSESTree.Node): TSESTree.Node | undefined;
export declare function removeLengthNode(node: TSESTree.Node, fixer: TSESLint.RuleFixer, context: HelperContext): TSESLint.RuleFix;
export declare const isLeftHandSide: (node: TSESTree.Node) => boolean;
export declare function getParentheses(node: TSESTree.Node, context: HelperContext): TSESTree.Token[];
export declare function getParenthesizedRange(node: TSESTree.Node, context: HelperContext): [number, number];
export declare function getParenthesizedText(node: TSESTree.Node, context: HelperContext): string;
export declare function isParenthesized(node: TSESTree.Node, context: HelperContext): boolean;
export declare function isNodeMatchesNameOrPath(node: TSESTree.Node, nameOrPath: string): boolean;
export declare function shouldAddParenthesesToMemberExpressionObject(node: TSESTree.Node, context: HelperContext): boolean;
export declare function needsSemicolon(tokenBefore: TSESTree.Token | null, context: HelperContext, code: string): boolean;
export declare function replaceMemberExpressionProperty(fixer: TSESLint.RuleFixer, memberExpression: TSESTree.MemberExpression, context: HelperContext, text: string): TSESLint.RuleFix;
export declare const removeMemberExpressionProperty: (fixer: TSESLint.RuleFixer, memberExpression: TSESTree.MemberExpression, context: HelperContext) => TSESLint.RuleFix;
export declare function removeMethodCall(fixer: TSESLint.RuleFixer, callExpression: TSESTree.CallExpression, context: HelperContext): IterableIterator<TSESLint.RuleFix>;
export {};
