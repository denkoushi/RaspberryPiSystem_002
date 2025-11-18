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
  plugins: ['unused-imports'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  parser: '@typescript-eslint/parser',
  rules: {
    'unused-imports/no-unused-imports': 'error'
  }
};
