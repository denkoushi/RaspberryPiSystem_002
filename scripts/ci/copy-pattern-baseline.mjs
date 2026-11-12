#!/usr/bin/env node
// Maintains per-file copy-pattern caps; update only lowers existing caps.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { copyPatternBudgetConfigs } from './eslint-copy-pattern-budget.mjs';

const [, , mode, app] = process.argv;
if (!['init', 'update', 'check'].includes(mode) || !['api', 'web'].includes(app)) {
  console.error('usage: copy-pattern-baseline.mjs <init|update|check> <api|web>');
  process.exit(2);
}
const appDir = path.resolve('apps', app);
const baselinePath = path.join(appDir, 'eslint-copy-pattern-baseline.json');
const require = createRequire(path.join(appDir, 'package.json'));
const { ESLint } = require('eslint');
const configs = copyPatternBudgetConfigs({ app, appDir, baseline: {} });
const current = {};
for (const config of configs) {
  for (const rule of Object.keys(config.rules ?? {})) current[rule.split('/')[1]] = {};
}
const eslint = new ESLint({
  errorOnUnmatchedPattern: false,
  cwd: appDir,
  overrideConfigFile: true,
  overrideConfig: [{
    files: app === 'web' ? ['src/**/*.ts', 'src/**/*.tsx'] : ['src/**/*.ts'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } }
    },
    linterOptions: { noInlineConfig: true }
  }, ...configs]
});
const results = await eslint.lintFiles(['src']);
for (const result of results) {
  const file = path.relative(appDir, result.filePath).split(path.sep).join('/');
  for (const message of result.messages) {
    if (message.fatal) throw new Error(`${file}: ${message.message}`);
    const rule = message.ruleId?.replace(/^copy-pattern-budget\//, '');
    if (Object.hasOwn(current, rule)) current[rule][file] = (current[rule][file] ?? 0) + 1;
  }
}
const previous = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {};
const next = {};
const lowered = [];
for (const rule of Object.keys(current).sort()) {
  next[rule] = {};
  const entries = mode === 'init' ? current[rule] : previous[rule] ?? {};
  for (const file of Object.keys(entries).sort()) {
    const cap = entries[file];
    const count = mode === 'init' ? cap : Math.min(cap, current[rule][file] ?? 0);
    if (count < cap) lowered.push(`${rule} ${file}: ${cap} -> ${count}`);
    if (count > 0) next[rule][file] = count;
  }
}
if (mode === 'check') {
  console.log(lowered.length ? lowered.join('\n') : 'baseline is current');
} else {
  fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`${baselinePath}: ${Object.values(next).reduce((sum, entries) => sum + Object.keys(entries).length, 0)} entries`);
  if (lowered.length) console.log(lowered.join('\n'));
}
