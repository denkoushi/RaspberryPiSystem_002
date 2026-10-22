import fs from 'node:fs';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Size ratchet: new source files stay within 600 lines; files listed in the baseline were
// already larger and are capped at their recorded size. Regenerate with
// `node scripts/ci/max-lines-baseline.mjs update web` (it only lowers caps).
const maxLinesBaseline = JSON.parse(fs.readFileSync(new URL('./eslint-max-lines-baseline.json', import.meta.url), 'utf8'));
const maxLinesOptions = { skipBlankLines: true, skipComments: true };
const maxLinesOverrides = [
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', '**/__tests__/**', 'src/test/**', 'src/generated/**'],
    rules: { 'max-lines': ['error', { max: 600, ...maxLinesOptions }] }
  },
  ...Object.entries(maxLinesBaseline).map(([file, max]) => ({
    files: [file],
    rules: { 'max-lines': ['error', { max, ...maxLinesOptions }] }
  }))
];

export default tseslint.config(
  // Flat config includes JavaScript and dotfiles by default; retain the old .ts/.tsx-only target set.
  { ignores: ['**/node_modules/**', '**/.*', '**/*.{js,cjs,mjs}'] },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactPlugin.configs.flat.recommended,
      reactHooks.configs['recommended-latest'],
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.typescript,
      prettier
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.test.json'],
        ecmaFeatures: { jsx: true },
        tsconfigRootDir: import.meta.dirname
      }
    },
    settings: { react: { version: 'detect' } },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      // Preserve ESLint 8 / typescript-eslint 7 recommended behavior.
      'no-constant-binary-expression': 'off',
      'no-constant-condition': ['error', { checkLoops: 'all' }],
      'no-empty-static-block': 'off',
      'no-new-native-nonconstructor': 'off',
      'no-unused-private-class-members': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'error',
      '@typescript-eslint/prefer-namespace-keyword': 'off',
      // ban-types prohibited {} types, Function and boxed primitives, but allowed empty interfaces.
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'always' }],
      'react/react-in-jsx-scope': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'import/no-unresolved': 'off',
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true }
        }
      ],
      'import/no-cycle': 'error',
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/features',
              from: './src/pages',
              message: 'features層からpages層への依存は禁止です（依存方向: pages -> features）。'
            },
            {
              target: './src/components',
              from: './src/pages',
              message: 'components層からpages層への依存は禁止です（依存方向: pages -> components）。'
            },
            {
              target: './src/hooks',
              from: './src/pages',
              message: 'hooks層からpages層への依存は禁止です（依存方向: pages -> hooks）。'
            },
            {
              target: './src/lib',
              from: './src/pages',
              message: 'lib層からpages層への依存は禁止です（依存方向: pages -> lib）。'
            },
            {
              target: './src/api',
              from: './src/pages',
              message: 'api層からpages層への依存は禁止です（依存方向: pages -> api）。'
            },
            {
              target: './src/layouts',
              from: './src/pages',
              message: 'layouts層からpages層への依存は禁止です（依存方向: pages -> layouts）。'
            },
            {
              target: './src/utils',
              from: './src/pages',
              message: 'utils層からpages層への依存は禁止です（依存方向: pages -> utils）。'
            }
          ]
        }
      ]
    }
  },
  ...[
    ...maxLinesOverrides,
    {
      files: [
        'src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx',
        'src/features/assembly/KioskAssemblyTemplateEditorFeature.tsx'
      ],
      rules: {
        'max-lines': ['error', { max: 180, skipBlankLines: true, skipComments: true }],
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/api/client'],
                message: '組立テンプレート編集のルート層からAPI clientを直接参照しないでください。'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['src/features/assembly/template-editor/AssemblyTemplateEditor*.tsx'],
      rules: {
        'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
        'max-lines-per-function': [
          'error',
          { max: 220, skipBlankLines: true, skipComments: true }
        ],
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'react-router-dom',
                message: '表示部品はルーターに依存せず、ルート層からナビゲーションを受け取ってください。'
              }
            ],
            patterns: [
              {
                group: ['../../../api/*', '../../../pages/*'],
                message: '表示部品からAPI clientまたはpages層への依存は禁止です。'
              }
            ]
          }
        ]
      }
    },
    {
      files: [
        'src/features/assembly/template-editor/useAssemblyTemplate*.ts',
        'src/features/assembly/template-editor/buildAssemblyTemplateSaveInput.ts'
      ],
      rules: {
        'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
        'max-lines-per-function': [
          'error',
          { max: 500, skipBlankLines: true, skipComments: true }
        ],
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'react-router-dom',
                message: '編集ロジックはルーターに依存しないでください。'
              }
            ],
            patterns: [
              {
                group: ['../../../pages/*'],
                message: 'template-editorからpages層への逆依存は禁止です。'
              }
            ]
          }
        ]
      }
    }
  ].map(config => ({
    ...config,
    files: config.files.flatMap(file => ['**/*.ts', '**/*.tsx'].map(extension => [extension, file]))
  }))
);
