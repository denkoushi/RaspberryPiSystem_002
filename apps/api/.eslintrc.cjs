module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  parserOptions: {
    sourceType: 'module',
    project: './tsconfig.eslint.json'
  },
  plugins: ['unused-imports', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier'
  ],
  parser: '@typescript-eslint/parser',
  rules: {
    'unused-imports/no-unused-imports': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    'import/no-unresolved': 'off',
    'import/order': 'off',
    'import/no-cycle': 'error',
    'import/no-restricted-paths': [
      'error',
      {
        zones: [
          {
            target: './src/services',
            from: './src/routes',
            message: 'services層からroutes層への依存は禁止です（依存方向: routes -> services）。'
          },
          {
            target: './src/lib',
            from: './src/routes',
            message: 'lib層からroutes層への依存は禁止です（依存方向: routes/services -> lib）。'
          },
          {
            target: './src/lib',
            from: './src/services',
            message: 'lib層からservices層への依存は禁止です（依存方向: routes/services -> lib）。'
          },
          {
            target: './src/routes/clients',
            from: './src/routes/kiosk',
            message: 'routes/kiosk から routes/clients への依存は禁止です（機能境界の横断を防止）。'
          },
          {
            target: './src/routes/kiosk',
            from: './src/routes/clients',
            message: 'routes/clients から routes/kiosk への依存は禁止です（機能境界の横断を防止）。'
          },
          {
            target: './src/routes/backup',
            from: './src/routes/imports',
            message: 'routes/imports から routes/backup への依存は禁止です（機能境界の横断を防止）。'
          },
          {
            target: './src/routes/imports',
            from: './src/routes/backup',
            message: 'routes/backup から routes/imports への依存は禁止です（機能境界の横断を防止）。'
          },
          {
            target: './src/routes/system',
            from: './src/routes/kiosk',
            message: 'routes/kiosk から routes/system への依存は禁止です（機能境界の横断を防止）。'
          },
          {
            target: './src/routes/kiosk',
            from: './src/routes/system',
            message: 'routes/system から routes/kiosk への依存は禁止です（機能境界の横断を防止）。'
          }
        ]
      }
    ]
  },
  overrides: [
    {
      files: ['src/services/part-measurement/self-inspection.service.ts'],
      rules: {
        'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],
        'max-lines-per-function': [
          'error',
          { max: 40, skipBlankLines: true, skipComments: true, IIFEs: true }
        ],
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/lib/prisma.js', '**/lib/prisma'],
                message: 'SelfInspectionService facade must delegate database work to use cases.'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['src/services/part-measurement/self-inspection/use-cases/**/*.ts'],
      rules: {
        'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
        'max-lines-per-function': [
          'error',
          { max: 220, skipBlankLines: true, skipComments: true, IIFEs: true }
        ],
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/self-inspection.service.js', '**/self-inspection.service'],
                message: 'Self-inspection use cases must not depend on their facade.'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['src/**/*.{test,spec}.ts', 'src/**/__tests__/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'unused-imports/no-unused-imports': 'off'
      }
    }
  ]
};
