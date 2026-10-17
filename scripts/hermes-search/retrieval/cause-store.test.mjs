import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCauseQuestions, conditionSha256 } from './cause-categories.mjs';
import { CAUSE_STORE_SCHEMA, readCauseStore, writeCauseStore, readCauseFailures, writeCauseFailures, causeFailuresPathFor } from './cause-store.mjs';

test('cause store roundtrips, skips malformed rows and treats missing files as empty', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cause-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'store.jsonl');
  assert.equal((await readCauseStore(file)).size, 0);
  const textSha256 = conditionSha256('fixture');
  const row = { schema: CAUSE_STORE_SCHEMA, textSha256, categoryId: 'check', promptSha256: buildCauseQuestions([]).promptSha256, classifiedAt: '2026-10-17T00:00:00.000Z' };
  const expected = new Map([[textSha256, row]]);
  await writeCauseStore(file, expected);
  await appendFile(file, `broken\n{}\n${JSON.stringify({ ...row, categoryId: 'invalid' })}\n`);
  assert.deepEqual(await readCauseStore(file), expected);
  const failuresFile = causeFailuresPathFor(file);
  assert.equal((await readCauseFailures(failuresFile)).size, 0);
  const failures = new Map([[textSha256, { textSha256, attempts: 3, lastAt: row.classifiedAt }]]);
  await writeCauseFailures(failuresFile, failures);
  assert.deepEqual(await readCauseFailures(failuresFile), failures);
});
