import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { records } from './fixtures/synthetic-records.mjs';
import { loadNonconformityCatalog } from './catalog.mjs';
import { missedQuestions, nightOf, proposeFromMisses } from './learning-proposals.mjs';
import { runLearningPass } from './learning-night.mjs';

const catalog = loadNonconformityCatalog();

const receipt = (at, question, outcome, semanticQuery = question) => JSON.stringify({
  at, sessionId: 's', recordIds: [], hermesReceipt: { outcome, question, plan: { filters: [], semanticQuery } },
});

test('a night keeps one id across midnight', () => {
  assert.equal(nightOf(new Date('2026-09-29T13:30:00Z')), '2026-09-29');
  assert.equal(nightOf(new Date('2026-09-29T18:30:00Z')), '2026-09-29');
  assert.equal(nightOf(new Date('2026-09-30T04:00:00Z')), '2026-09-30');
});

test('only content questions without a result are picked, once each and newer than the last pass', () => {
  const rows = [
    receipt('2026-09-29T01:00:00Z', 'filter only', 'no_result', ''),
    receipt('2026-09-29T01:01:00Z', 'surface scratch', 'no_result'),
    receipt('2026-09-29T01:02:00Z', 'surface scratch', 'no_result'),
    receipt('2026-09-29T01:03:00Z', 'answered', 'answer'),
    receipt('2026-09-29T01:04:00Z', 'nothing else', 'no_other'),
  ].map((line) => JSON.parse(line));
  assert.deepEqual(missedQuestions(rows).map((item) => item.question), ['surface scratch']);
  // A newer repeat of a missed question is new evidence and is picked again.
  assert.deepEqual(missedQuestions(rows, '2026-09-29T01:01:30Z').map((item) => item.at), ['2026-09-29T01:02:00Z']);
  assert.deepEqual(missedQuestions(rows, '2026-09-29T01:05:00Z'), []);
});

test('a missed question is judged over a deeper pool and accepted pairs become proposals once per night', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'learning-'));
  const receiptsDir = path.join(directory, 'receipts');
  await mkdir(receiptsDir);
  await writeFile(path.join(receiptsDir, 'receipts-2026-09-29.jsonl'), `${receipt('2026-09-29T02:00:00Z', 'surface scratchの件', 'no_result')}\n`);
  const proposalsPath = path.join(directory, 'proposals.jsonl');
  const statePath = path.join(directory, 'state.json');
  const target = records.find((record) => record.condition.includes('surface scratch'));
  const judged = [];
  const judge = async ({ semanticQuery, candidates }) => {
    judged.push({ semanticQuery, count: candidates.length });
    return { ok: true, ranked: candidates.filter((candidate) => candidate.id === target.id).map((candidate) => ({ id: candidate.id, probability: 0.8 })) };
  };
  const options = { records, catalog, judge, receiptsDir, proposalsPath, statePath, now: () => new Date('2026-09-29T13:30:00Z') };
  const first = await proposeFromMisses(options);
  assert.equal(first.reason, 'completed');
  assert.equal(first.questions, 1);
  assert.equal(first.proposals, 1);
  assert.match(judged[0].semanticQuery, /^surface scratch/);
  const rows = (await readFile(proposalsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(rows.map((row) => [row.question, row.recordId, row.night]), [['surface scratchの件', target.id, '2026-09-29']]);
  const again = await proposeFromMisses({ ...options, now: () => new Date('2026-09-29T16:00:00Z') });
  assert.equal(again.reason, 'done');
  const nextNight = await proposeFromMisses({ ...options, now: () => new Date('2026-09-30T13:30:00Z') });
  assert.equal(nextNight.questions, 0);
});

test('the night pass stays off outside the window or when disabled', async () => {
  const env = { HERMES_RETRIEVAL_ENRICHMENT_ENABLED: 'true', HERMES_RETRIEVAL_ENRICHMENT_WINDOW: '22-6' };
  const propose = async () => ({ reason: 'completed' });
  assert.equal((await runLearningPass({ rows: records, env, now: () => new Date('2026-09-29T03:00:00Z'), propose })).reason, 'outside_window');
  assert.equal((await runLearningPass({ rows: records, env: { ...env, HERMES_RETRIEVAL_LEARNING: 'off' }, now: () => new Date('2026-09-29T13:30:00Z'), propose })).reason, 'disabled');
  assert.equal((await runLearningPass({ rows: records, env: { ...env, HERMES_RETRIEVAL_ENRICHMENT_STORE: '/nonexistent/store.jsonl' }, now: () => new Date('2026-09-29T13:30:00Z'), propose })).reason, 'completed');
});
