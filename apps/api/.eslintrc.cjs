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
