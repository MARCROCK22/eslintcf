import type { TSESLint } from '@typescript-eslint/utils';
import { ESLintUtils } from '@typescript-eslint/utils';
export default function create(createRule: ReturnType<typeof ESLintUtils.RuleCreator>): TSESLint.RuleModule<"slice" | "negativeIndex" | "index" | "stringCharAtNegative" | "stringCharAt" | "getLastFunction" | "useAt", [{}], unknown, TSESLint.RuleListener> & {
    name: string;
};
