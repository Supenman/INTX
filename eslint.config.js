import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      // 领域层必须是纯的：禁止任何 IO。这条规则是架构约束的自动化执行。
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infra/**', '**/app/**', '**/ui/**'],
              message: 'domain 层不能依赖上层。依赖方向只能是 ui/app → domain ← infra。',
            },
          ],
        },
      ],
    },
  },
  {
    // 只有领域层受"禁止 IO"约束；infra/app/ui 与入口装配文件各自放开
    files: ['src/infra/**', 'src/app/**', 'src/ui/**', 'src/main.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['src/**/*.test.ts', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // E2E 是 Node 脚本，不是浏览器代码；领域层的"禁止 IO"约束也不适用。
    files: ['e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-restricted-imports': 'off' },
  },
);
