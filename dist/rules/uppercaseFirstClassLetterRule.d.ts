import type { ESLintUtils } from '@typescript-eslint/utils';
export default function create(createRule: ReturnType<typeof ESLintUtils.RuleCreator>): ESLintUtils.RuleModule<"uppercaseFirstClassLeter", [], unknown, ESLintUtils.RuleListener>;
