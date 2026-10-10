import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GRADE_BATCH } from './graded-labels.mjs';
import {
  collectShownPairs, labelShownPairs, readShownLabels, relevantWithLabels, writeShownLabels,
} from './flywheel-shown-labels.mjs';

const grade = (g) => ({ g, p: [0, 0, 0, 1] });
const evaluate = async ({ questions }) => ({
  answers: Object.fromEntries(Object.keys(questions).map((key) => [key, {
    type: 'choice', choice: 'g3', probabilities: { g0: 0.01, g1: 0.02, g2: 0.03, g3: 0.94 },
  }])),
});

test('shown-pair labeling excludes filter questions', () => {
  assert.deepEqual(collectShownPairs({ questions: [{ id: 'f-a', kind: 'filter', question: 'recent', relevant: [] }],
    runs: [{ cases: [{ id: 'f-a', shown: ['a'] }] }] }), []);
});

test('collectShownPairs excludes relevant and labelled pairs, deduplicates across runs, and normalizes ids', () => {
  const questions = [
    { id: 'a', question: 'question a', relevant: ['a', 'nonconformity:b'] },
    { id: 'other', question: 'question other', relevant: ['other'] },
  ];
  const runs = [
    { cases: [
      { id: 'nonconformity:a', shown: ['nonconformity:a', 'b', 'c', 'nonconformity:c', 'labelled'], candidates: ['candidate-only'] },
      { id: 'unknown', shown: ['x'] },
      { id: 'other', shown: ['c'] },
    ] },
    { cases: [{ id: 'a', shown: ['c', 'd'] }, { id: 'other' }] },
  ];
  assert.deepEqual(collectShownPairs({ questions, runs, labels: { a: { labelled: grade(0) } } }), [
    { anchorId: 'a', question: 'question a', recordId: 'c' },
    { anchorId: 'other', question: 'question other', recordId: 'c' },
    { anchorId: 'a', question: 'question a', recordId: 'd' },
  ]);
  assert.equal(collectShownPairs({ questions, runs }).length, 4);
});

test('labelShownPairs groups questions, batches records, updates labels in place and calls onBatch', async () => {
  const pairs = [
    { anchorId: 'a', question: 'question a', recordId: 'r1' },
    { anchorId: 'b', question: 'question b', recordId: 'r1' },
    { anchorId: 'a', question: 'question a', recordId: 'r2' },
    { anchorId: 'a', question: 'question a', recordId: 'r3' },
    { anchorId: 'a', question: 'question a', recordId: 'r1' },
    { anchorId: 'a', question: 'question a', recordId: 'existing' },
  ];
  const recordsById = new Map(['r1', 'r2', 'r3'].map((id) => [id, { condition: ` body ${id} `, metadata: 'excluded' }]));
  const labels = { a: { existing: grade(1) } };
  const calls = [];
  const savedCounts = [];
  const result = await labelShownPairs({
    pairs, recordsById, bodyFields: ['condition'], fieldLabels: { condition: '現象' }, labels, batchSize: 2,
    evaluate: async (input) => {
      calls.push(input);
      return evaluate(input);
    },
    onBatch: async (current) => {
      assert.equal(current, labels);
      savedCounts.push(Object.values(current).reduce((sum, entries) => sum + Object.keys(entries).length, 0));
    },
  });
  assert.deepEqual(result, { graded: 4, skipped: 0 });
  assert.deepEqual(calls.map((call) => [call.state.request, Object.keys(call.questions).length]), [
    ['question a', 2], ['question a', 1], ['question b', 1],
  ]);
  assert.match(calls[0].questions.c0.instructions, /現象: body r1/u);
  assert.equal(calls[0].questions.c0.instructions.includes('excluded'), false);
  assert.deepEqual(savedCounts, [3, 4, 5]);
  assert.deepEqual(labels.a.r1, { g: 3, p: [0.01, 0.02, 0.03, 0.94] });
  assert.deepEqual(labels.a.existing, grade(1));
  assert.deepEqual(labels.b.r1, labels.a.r1);
});

test('labelShownPairs skips missing records and uses the default grade batch size', async () => {
  const ids = Array.from({ length: GRADE_BATCH + 1 }, (_, index) => `r${index}`);
  const pairs = [...ids, 'missing'].map((recordId) => ({ anchorId: 'a', question: 'question', recordId }));
  const labels = {};
  const batchSizes = [];
  const result = await labelShownPairs({
    pairs, labels, recordsById: new Map(ids.map((id) => [id, { condition: id }])), bodyFields: ['condition'],
    evaluate: async (input) => {
      batchSizes.push(Object.keys(input.questions).length);
      return evaluate(input);
    },
  });
  assert.deepEqual(result, { graded: GRADE_BATCH + 1, skipped: 1 });
  assert.deepEqual(batchSizes, [GRADE_BATCH, 1]);
  assert.equal('missing' in labels.a, false);
});

test('completed batches survive interruption and a resumed call only grades unlabelled pairs', async () => {
  const pairs = ['r1', 'r2'].map((recordId) => ({ anchorId: 'a', question: 'question', recordId }));
  const labels = {};
  const options = { pairs, labels, recordsById: new Map([['r1', { condition: 'one' }], ['r2', { condition: 'two' }]]), bodyFields: ['condition'], evaluate, batchSize: 1 };
  await assert.rejects(labelShownPairs({ ...options, onBatch: () => { throw new Error('interrupted'); } }), /interrupted/u);
  assert.deepEqual(Object.keys(labels.a), ['r1']);
  assert.deepEqual(await labelShownPairs(options), { graded: 1, skipped: 0 });
  assert.deepEqual(Object.keys(labels.a), ['r1', 'r2']);
});

test('unanswered grades remain unlabelled and can be retried', async () => {
  const labels = {};
  const options = {
    pairs: [{ anchorId: 'a', question: 'question', recordId: 'r1' }], labels,
    recordsById: new Map([['r1', { condition: 'one' }]]), bodyFields: ['condition'],
  };
  assert.deepEqual(await labelShownPairs({ ...options, evaluate: async () => ({ answers: {} }) }), { graded: 0, skipped: 0 });
  assert.equal(labels.a.r1, undefined);
  assert.deepEqual(await labelShownPairs({ ...options, evaluate }), { graded: 1, skipped: 0 });
  await assert.rejects(labelShownPairs({ ...options, evaluate, batchSize: 0 }), /batchSize/u);
});

test('relevantWithLabels adds only grade 3, normalizes and deduplicates without changing the question', () => {
  const question = { id: 'nonconformity:a', relevant: ['nonconformity:a', 'b'] };
  const labels = { a: { 'nonconformity:b': grade(3), 'nonconformity:c': grade(3), d: grade(2), e: grade(1), f: grade(0) }, other: { z: grade(3) } };
  assert.deepEqual(relevantWithLabels(question, labels), ['a', 'b', 'c']);
  assert.deepEqual(question.relevant, ['nonconformity:a', 'b']);
  assert.deepEqual(relevantWithLabels(question, {}), ['a', 'b']);
});

test('shown labels round-trip with private permissions and no temporary files left behind', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'flywheel-shown-labels-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'nested', 'labels.json');
  assert.deepEqual(readShownLabels(file), {});
  const labels = { a: { r1: grade(3), r2: grade(0) } };
  writeShownLabels(file, labels);
  assert.deepEqual(readShownLabels(file), labels);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  chmodSync(file, 0o644);
  writeShownLabels(file, { b: { r3: grade(2) } });
  assert.deepEqual(readShownLabels(file), { b: { r3: grade(2) } });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(path.dirname(file)), ['labels.json']);
  const nightly = { a: { r1: { g: 3, dgx: 3, jev: 3, night: '2026-10-03' }, r2: { g: null, dgx: null, jev: 3, night: '2026-10-03' } } };
  writeFileSync(file, JSON.stringify({ schema: 'hermes-flywheel-labels/v1', labels: nightly }));
  assert.deepEqual(readShownLabels(file), nightly);
  assert.deepEqual(relevantWithLabels({ id: 'a', relevant: ['a'] }, readShownLabels(file)), ['a', 'r1']);
  writeFileSync(file, '{invalid');
  assert.throws(() => readShownLabels(file), SyntaxError);
});
