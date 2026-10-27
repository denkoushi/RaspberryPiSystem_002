import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Flat config includes JavaScript and dotfiles by default; retain the old .ts-only target set.
  { ignores: ['**/node_modules/**', 'dist/**', 'vitest.config.ts', '**/.*', '**/*.{js,cjs,mjs}'] },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.typescript,
      prettier
    ],
    languageOptions: {
      globals: { ...globals.es2022 },
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname
      }
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      // Preserve ESLint 8 / typescript-eslint 7 recommended behavior.
      'no-constant-binary-expression': 'off',
      'no-constant-condition': ['error', { checkLoops: 'all' }],
      'no-empty-static-block': 'off',
      'no-new-native-nonconstructor': 'off',
      'no-unused-private-class-members': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'error',
      '@typescript-eslint/prefer-namespace-keyword': 'off',
      // Preserve the old recommended-type-checked rules and option defaults.
      '@typescript-eslint/no-array-delete': 'off',
      '@typescript-eslint/no-unsafe-unary-minus': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/no-floating-promises': ['error', { checkThenables: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allow: [] }],
      // ban-types prohibited {} types, Function and boxed primitives, but allowed empty interfaces.
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'always' }],
      'import/no-unresolved': 'off',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true }
        }
      ],
      'import/no-cycle': 'error'
    }
  }
);
