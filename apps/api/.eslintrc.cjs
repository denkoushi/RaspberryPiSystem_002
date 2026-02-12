module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  parserOptions: {
    sourceType: 'module',
    project: './tsconfig.json'
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
          }
        ]
      }
    ]
  },
  overrides: [
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
