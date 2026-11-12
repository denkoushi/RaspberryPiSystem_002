import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { copyPatternBudgetConfigs } from './eslint-copy-pattern-budget.mjs';

const appDir = path.resolve('apps/web');
const require = createRequire(path.join(appDir, 'package.json'));
const { Linter } = require('eslint');
const parser = require('@typescript-eslint/parser');
const file = 'src/features/example.ts';
function lint(code, baseline = {}, filename = file, app = 'web') {
  const dir = app === 'web' ? appDir : path.resolve('apps/api');
  const messages = new Linter({ cwd: dir }).verify(code, [
    { files: ['**/*.ts', '**/*.tsx'], languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } } },
    ...copyPatternBudgetConfigs({ app, appDir: dir, baseline })
  ], { filename: path.join(dir, filename) });
  assert.equal(messages.filter(message => message.fatal).length, 0, JSON.stringify(messages));
  return messages.filter(message => message.ruleId?.startsWith('copy-pattern-budget/'));
}
const cases = {
  'x-client-key-literal': ["const x = { 'X-CLIENT-KEY': `x-client-key` };", 2],
  'manual-api-error-message': ["e.response.data.message; e?.response?.data?.['message'];", 2],
  'direct-http-client': ['fetch(url); window.fetch(url); globalThis.fetch(url); self.fetch(url);', 4],
  'ten-digit-regex': [String.raw`/^\d{10}$/; /^[0-9]{10}$/i; new RegExp('^\\d{10}$'); RegExp('^[0-9]{10}$');`, 4]
};
for (const [rule, [code, count]] of Object.entries(cases)) {
  test(`${rule}: at or below cap passes`, () => {
    assert.equal(lint(code, { [rule]: { [file]: count } }).length, 0);
    assert.equal(lint(code, { [rule]: { [file]: count + 1 } }).length, 0);
  });
  test(`${rule}: cap + 1 reports every match`, () => {
    const messages = lint(code, { [rule]: { [file]: count - 1 } });
    assert.equal(messages.length, count);
    for (const message of messages) {
      assert.equal(message.ruleId, `copy-pattern-budget/${rule}`);
      assert.match(message.message, new RegExp(`上限 ${count - 1} 件、現在 ${count} 件`));
      assert.ok(message.message.includes('node scripts/ci/copy-pattern-baseline.mjs update web'));
    }
  });
  test(`${rule}: new file has zero cap`, () => {
    assert.equal(lint(code, { [rule]: { 'src/features/old.ts': 100 } }).length, count);
  });
}

test('client key: interpolated templates and other values do not count', () => {
  assert.equal(lint('const a = `x-client-${key}`; const b = "x-client-key-extra";').length, 0);
});
test('error message: wrappers and a continuous chain count once', () => {
  const code = `(((e?.response! as any).data satisfies any)!)?.['message'];
    e.response.data.message.response.data.message;
    e.response.data.other; e.data.message;`;
  assert.equal(lint(code).length, 2);
});
test('axios: error helpers, type imports, aliases and shadowing are excluded', () => {
  const code = `import type Axios from 'axios';
    import { type AxiosInstance, isAxiosError as isError, AxiosError } from 'axios';
    import ax from 'axios'; import * as ns from 'axios';
    isError(e); ax.isAxiosError(e); ns.AxiosError; ax['isAxiosError'](e);
    function local(ax: any) { ax.get(url); ax(url); }
    type T = import('axios').AxiosInstance;`;
  assert.equal(lint(code).length, 0);
});
test('axios: named value specifiers and default/namespace client uses count', () => {
  const code = `import ax from 'axios'; import * as ns from 'axios';
    import { get as read, post, isAxiosError, AxiosError, type AxiosInstance } from 'axios';
    ax(url); ax.get(url); ax['post'](url); ns.get; ns(url);
    import('axios'); require('axios');`;
  assert.equal(lint(code).length, 9);
});
test('axios: binding lookup also handles calls before imports', () => {
  assert.equal(lint("ax.get(url); import ax from 'axios';").length, 1);
});
test('regex: other patterns and dynamic values do not count', () => {
  assert.equal(lint(String.raw`/\d{10}/; /^\d{9}$/; new RegExp(pattern); RegExp('^\\d{10}$' + suffix);`).length, 0);
});
test('factory: API directory permits fetch and applies regex rule', () => {
  const messages = lint(String.raw`fetch(url); /^\d{10}$/;`, {}, 'src/api/http.ts');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].ruleId, 'copy-pattern-budget/ten-digit-regex');
});
test('factory: rule targets overlap without overwriting per-rule options', () => {
  const code = "const header = 'x-client-key'; e.response.data.message; fetch(url);";
  const messages = lint(code, { 'x-client-key-literal': { [file]: 1 }, 'direct-http-client': { [file]: 1 } });
  assert.deepEqual(messages.map(message => message.ruleId), ['copy-pattern-budget/manual-api-error-message']);
});
test('factory: client-key and error-message targets differ', () => {
  assert.equal(lint("'x-client-key'; e.response.data.message;", {}, 'src/api/domains/example.ts').length, 1);
  const messages = lint("'x-client-key'; e.response.data.message;", {}, 'src/pages/example.ts');
  assert.deepEqual(messages.map(message => message.ruleId), ['copy-pattern-budget/manual-api-error-message']);
});
test('factory: all max-lines exclusions are excluded', () => {
  const code = String.raw`'x-client-key'; e.response.data.message; fetch(url); /^\d{10}$/;`;
  for (const filename of [
    'src/features/a.test.ts', 'src/features/a.test.tsx', 'src/features/a.spec.ts',
    'src/features/a.spec.tsx', 'src/features/__tests__/a.ts', 'src/test/a.ts', 'src/generated/a.ts'
  ]) assert.equal(lint(code, {}, filename).length, 0, filename);
});
test('factory: API only enforces regex, with independent app-relative baseline', () => {
  const filename = 'src/routes/example.ts';
  const code = String.raw`fetch(url); /^\d{10}$/;`;
  assert.equal(lint(code, {}, filename, 'api').length, 1);
  assert.equal(lint(code, { 'ten-digit-regex': { [filename]: 1 } }, filename, 'api').length, 0);
});
