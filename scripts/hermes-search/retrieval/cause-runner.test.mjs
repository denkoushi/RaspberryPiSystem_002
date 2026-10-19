import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCauseQuestions, conditionSha256 } from './cause-categories.mjs';
import { causeFailuresPathFor, readCauseFailures, readCauseStore, writeCauseStore } from './cause-store.mjs';
import { runCauseBatch } from './cause-runner.mjs';

const answer = ({ questions }) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { choice: 'check', confidence: 0.9 }])) });
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cause-runner-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { storePath: path.join(dir, 'store.jsonl'), statusPath: path.join(dir, 'status.json'),
    env: { HERMES_RETRIEVAL_CAUSE_ENABLED: 'true' }, evaluate: answer };
}

test('runner deduplicates normalized text, skips empty and other sources, caps work and persists hashes only', async t => {
  const options = await fixture(t);
  const logs = [];
  t.mock.method(console, 'info', line => logs.push(line));
  const records = Array.from({ length: 25 }, (_, index) => ({ id: `id-${index}`, kind: 'nonconformity', condition: `fixture-${index}` }));
  records.push({ condition: ' fixture-0\n' }, { condition: '  ' }, { kind: 'knowledge_procedure', condition: 'excluded-fixture' });
  const calls = [];
  const status = await runCauseBatch({ ...options, records, env: { ...options.env, HERMES_RETRIEVAL_CAUSE_MAX_TEXTS: '12' }, evaluate: input => { calls.push(input); return answer(input); } });
  assert.deepEqual(calls.map(call => call.state.records.length), [10, 2]);
  assert.deepEqual(status.texts, { total: 25, classified: 12, pending: 13, failed: 0 });
  assert.equal(status.processed, 12);
  assert.equal(status.calls, 2);
  const store = await readCauseStore(options.storePath);
  assert.equal(store.size, 12);
  assert.ok(store.has(conditionSha256(records[0].condition)));
  assert.equal(store.has(records[0].id), false);
  const persisted = (await readFile(options.statusPath, 'utf8')) + (await readFile(options.storePath, 'utf8')) + logs.join('\n');
  assert.equal(records.some(row => row.condition.trim() && persisted.includes(row.condition.trim())), false);
  assert.deepEqual(logs, ['hermes retrieval cause reason=completed processed=12']);
  const next = await runCauseBatch({ ...options, records });
  assert.equal(next.processed, 13);
});

test('runner reclassifies an old prompt and skips current cached text', async t => {
  const options = await fixture(t);
  const records = [{ condition: 'fixture' }];
  await runCauseBatch({ ...options, records });
  const store = await readCauseStore(options.storePath);
  store.get(conditionSha256('fixture')).promptSha256 = '0'.repeat(64);
  await writeCauseStore(options.storePath, store);
  assert.equal((await runCauseBatch({ ...options, records })).processed, 1);
  assert.equal((await readCauseStore(options.storePath)).get(conditionSha256('fixture')).promptSha256, buildCauseQuestions([]).promptSha256);
  const cached = await runCauseBatch({ ...options, records, evaluate: () => { throw Error('must not call'); } });
  assert.equal(cached.reason, 'nothing_to_do');
  assert.equal(cached.processed, 0);
});

test('runner stops retrying after three content failures per text', async t => {
  const options = await fixture(t);
  const records = [{ condition: 'fixture' }];
  const evaluate = () => ({ answers: { r1: { choice: 'invalid' } } });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const status = await runCauseBatch({ ...options, records, evaluate });
    assert.equal(status.processed, 1);
    assert.equal((await readCauseFailures(causeFailuresPathFor(options.storePath))).get(conditionSha256('fixture')).attempts, attempt);
  }
  const last = await runCauseBatch({ ...options, records, evaluate: () => { throw Error('must not call'); } });
  assert.equal(last.reason, 'nothing_to_do');
  assert.deepEqual(last.texts, { total: 1, classified: 0, pending: 0, failed: 1 });
});

test('transport failure backs off without counting attempts or exposing error contents', async t => {
  const options = await fixture(t);
  const logs = [];
  t.mock.method(console, 'info', line => logs.push(line));
  const status = await runCauseBatch({ ...options, records: Array.from({ length: 21 }, (_, i) => ({ condition: `fixture-${i}` })), evaluate: () => { throw Error('private-error-fixture'); } });
  assert.equal(status.reason, 'backoff');
  assert.equal(status.calls, 1);
  assert.equal(status.processed, 0);
  assert.equal((await readCauseFailures(causeFailuresPathFor(options.storePath))).size, 0);
  assert.equal(JSON.stringify(status).includes('private-error-fixture'), false);
  assert.deepEqual(logs, ['hermes retrieval cause reason=backoff processed=0']);
});

test('transport-reported content errors consume content attempts', async t => {
  const options = await fixture(t);
  const status = await runCauseBatch({ ...options, records: [{ condition: 'fixture' }], evaluate: () => {
    throw Object.assign(Error('invalid response'), { hermesDiagnostic: { failureCode: 'invalid_answers' } });
  } });
  assert.equal(status.reason, 'completed');
  assert.equal((await readCauseFailures(causeFailuresPathFor(options.storePath))).get(conditionSha256('fixture')).attempts, 1);
});

test('disabled gate makes no calls and writes a disabled status', async t => {
  const options = await fixture(t);
  const status = await runCauseBatch({ ...options, env: {}, records: [{ condition: 'fixture' }], evaluate: () => { throw Error('must not call'); } });
  assert.equal(status.reason, 'disabled');
  assert.equal(status.calls, 0);
  assert.equal(JSON.parse(await readFile(options.statusPath, 'utf8')).reason, 'disabled');
});

test('two concurrent batches persist together and stop scheduling after transport failure', async t => {
  const options = await fixture(t);
  let active = 0;
  let peak = 0;
  let calls = 0;
  const status = await runCauseBatch({ ...options, env: { ...options.env, HERMES_RETRIEVAL_CAUSE_CONCURRENCY: '2' },
    records: Array.from({ length: 40 }, (_, i) => ({ condition: `fixture-${i}` })), evaluate: async input => {
      calls += 1;
      const call = calls;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      if (call === 2) throw Error('transport');
      return answer(input);
    } });
  assert.equal(peak, 2);
  assert.equal(calls, 2);
  assert.equal(status.reason, 'backoff');
  assert.equal((await readCauseStore(options.storePath)).size, 10);
  assert.equal((await readCauseFailures(causeFailuresPathFor(options.storePath))).size, 0);
});
