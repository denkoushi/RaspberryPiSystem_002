import assert from 'node:assert/strict';
import test from 'node:test';

import { runInternalBackupCli } from '../../../apps/api/scripts/backup-internal-cli.mjs';

function createHarness(response = {
  ok: true,
  status: 200,
  text: async () => '{"success":true,"path":"backup/path"}',
}) {
  const calls = [];
  const stdout = [];
  const stderr = [];
  return {
    calls,
    stdout,
    stderr,
    dependencies: {
      fetch: async (...args) => {
        calls.push(args);
        return response;
      },
      writeStdout: (value) => stdout.push(value),
      writeStderr: (value) => stderr.push(value),
    },
  };
}

test('posts the requested target and label only to the fixed loopback endpoint', async () => {
  const harness = createHarness();
  const code = await runInternalBackupCli([
    '--kind', 'csv',
    '--source', 'employees',
    '--label', 'nightly',
  ], harness.dependencies);

  assert.equal(code, 0);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0][0], 'http://127.0.0.1:8080/api/backup/internal');
  assert.deepEqual(JSON.parse(harness.calls[0][1].body), {
    kind: 'csv',
    source: 'employees',
    metadata: { label: 'nightly' },
  });
  assert.deepEqual(harness.stdout, ['{"success":true,"path":"backup/path"}\n']);
  assert.deepEqual(harness.stderr, []);
});

test('omits metadata when no label is supplied', async () => {
  const harness = createHarness();
  const code = await runInternalBackupCli(
    ['--kind', 'csv', '--source', 'items'],
    harness.dependencies
  );

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(harness.calls[0][1].body), {
    kind: 'csv',
    source: 'items',
  });
});

test('returns non-zero when the endpoint rejects the request', async () => {
  const harness = createHarness({ ok: false, status: 403, text: async () => '{}' });
  const code = await runInternalBackupCli(
    ['--kind', 'csv', '--source', 'unknown'],
    harness.dependencies
  );

  assert.equal(code, 1);
  assert.deepEqual(harness.stdout, []);
  assert.match(harness.stderr.join(''), /HTTP 403/);
});

test('rejects invalid arguments before making a request', async () => {
  const harness = createHarness();
  const code = await runInternalBackupCli(['--kind', 'csv'], harness.dependencies);

  assert.equal(code, 2);
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(harness.stdout, []);
});

test('returns non-zero on transport failure', async () => {
  const harness = createHarness();
  harness.dependencies.fetch = async () => {
    throw new Error('connection refused');
  };
  const code = await runInternalBackupCli(
    ['--kind', 'csv', '--source', 'items'],
    harness.dependencies
  );

  assert.equal(code, 1);
  assert.deepEqual(harness.stdout, []);
  assert.match(harness.stderr.join(''), /request failed/);
});
