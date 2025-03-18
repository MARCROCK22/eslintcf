import type { ESLintUtils } from '@typescript-eslint/utils';
export default function create(createRule: ReturnType<typeof ESLintUtils.RuleCreator>): ESLintUtils.RuleModule<"noNewLine", [], unknown, ESLintUtils.RuleListener>;
