module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json', './tsconfig.test.json'],
    ecmaFeatures: {
      jsx: true
    },
    tsconfigRootDir: __dirname
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier'
  ],
  settings: {
    react: {
      version: 'detect'
    }
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
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
  },
  overrides: [
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
  ]
};
