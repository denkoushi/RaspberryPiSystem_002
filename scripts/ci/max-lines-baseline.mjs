#!/usr/bin/env node
// Maintains the per-file max-lines baseline used by apps/api and apps/web ESLint configs.
// New source files must stay within LIMIT lines; files that were already larger are capped
// at their recorded size so they can shrink but not grow.
//
// Usage (repository root):
//   node scripts/ci/max-lines-baseline.mjs init <app>    # write a fresh baseline (first adoption only)
//   node scripts/ci/max-lines-baseline.mjs update <app>  # lower or drop entries; never raises a cap
//   node scripts/ci/max-lines-baseline.mjs check <app>   # report entries that can be lowered
// <app> is "api" or "web".
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const LIMIT = 600;
export const HEADROOM = 30;
const COUNT_PATTERN = /File has too many lines \((\d+)\)/;

const [, , mode, app] = process.argv;
if (!['init', 'update', 'check'].includes(mode) || !['api', 'web'].includes(app)) {
  console.error('usage: max-lines-baseline.mjs <init|update|check> <api|web>');
  process.exit(2);
}

const appDir = path.resolve('apps', app);
const baselinePath = path.join(appDir, 'eslint-max-lines-baseline.json');
const require = createRequire(path.join(appDir, 'package.json'));
const { ESLint } = require('eslint');

const eslint = new ESLint({
  errorOnUnmatchedPattern: false,
  cwd: appDir,
  overrideConfigFile: true,
  overrideConfig: [{
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/__tests__/**',
      'src/test/**',
      'src/generated/**'
    ],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } }
    },
    rules: { 'max-lines': ['error', { max: LIMIT, skipBlankLines: true, skipComments: true }] }
  }]
});

// Flat config selects the extensions; directory traversal also avoids minimatch's glob partial-match differences.
const results = await eslint.lintFiles(['src']);
const current = {};
for (const result of results) {
  for (const message of result.messages) {
    const match = message.ruleId === 'max-lines' && COUNT_PATTERN.exec(message.message);
    if (match) current[path.relative(appDir, result.filePath)] = Number(match[1]);
  }
}

const previous = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {};
const next = {};
const lowered = [];
if (mode === 'init') {
  for (const [file, count] of Object.entries(current)) next[file] = count + HEADROOM;
} else {
  for (const [file, cap] of Object.entries(previous)) {
    const count = current[file];
    if (count === undefined) {
      lowered.push(`${file}: ${cap} -> removed (now within ${LIMIT})`);
      continue;
    }
    const target = Math.min(cap, count + HEADROOM);
    if (target < cap) lowered.push(`${file}: ${cap} -> ${target}`);
    next[file] = target;
  }
}

const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
if (mode === 'check') {
  console.log(lowered.length ? lowered.join('\n') : 'baseline is current');
} else {
  fs.writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`${baselinePath}: ${Object.keys(sorted).length} entries`);
  if (lowered.length) console.log(lowered.join('\n'));
}
