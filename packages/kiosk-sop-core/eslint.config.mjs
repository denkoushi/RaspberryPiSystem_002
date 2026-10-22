import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Flat config includes JavaScript and dotfiles by default; retain the old .ts-only target set.
  { ignores: ['**/node_modules/**', '**/.*', '**/*.{js,cjs,mjs}'] },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      prettier
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      sourceType: 'module',
      ecmaVersion: 'latest',
      parser: tseslint.parser,
      parserOptions: { tsconfigRootDir: import.meta.dirname }
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
      // ban-types prohibited {} types, Function and boxed primitives, but allowed empty interfaces.
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'always' }]
    }
  }
);
