import type { ESLintUtils } from '@typescript-eslint/utils';
export default function create(createRule: ReturnType<typeof ESLintUtils.RuleCreator>): ESLintUtils.RuleModule<"slice" | "negativeIndex" | "index" | "stringCharAtNegative" | "stringCharAt" | "splitIndexAccess" | "getLastFunction" | "useAt", [{}], unknown, ESLintUtils.RuleListener> & {
    name: string;
};
