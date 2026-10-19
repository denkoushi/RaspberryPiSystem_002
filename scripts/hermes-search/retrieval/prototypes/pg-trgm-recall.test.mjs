import test from 'node:test';
import assert from 'node:assert/strict';
import { readLabels, poolFor, readQuestions, scoreCandidates, summarizeBySplit } from './pg-trgm-recall.mjs';

const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n');

test('legacy labels retain set/case keys and grades', () => {
  const legacy = { 'stage-v1/case-1': { record1: { g: 3, p: [0, 0, 0, 1] }, record2: { g: 0 } } };
  assert.deepEqual(readLabels(JSON.stringify(legacy)), legacy);
});

test('schema selects flywheel labels and maps question IDs to case keys', () => {
  const pool = { record1: { g: 3, dgx: 3, jev: 3, night: '2026-10-07' }, record2: { g: 2, dgx: 2, jev: 2 } };
  const labels = readLabels(JSON.stringify({ schema: 'hermes-flywheel-labels/v1', labels: { 'anchor-1': pool } }));
  const [question] = readQuestions(jsonl([{ a: 'nonconformity:anchor-1', question: 'Fixture question', kept: true }]));
  assert.deepEqual(labels, { 'flywheel/anchor-1': pool });
  assert.deepEqual(scoreCandidates(['record1', 'record2', 'unknown'], labels[question.caseKey]), {
    top30: true, top200: true, unlabeled200: 1,
  });
  assert.deepEqual(scoreCandidates(['record2'], labels[question.caseKey]), {
    top30: false, top200: false, unlabeled200: 0,
  });
});

test('questions reader keeps content rows, strips prefixes, deduplicates and derives splits', () => {
  const rows = [
    { a: 'nonconformity:anchor-1', question: 'First fixture', kept: true },
    { a: 'anchor-1', question: 'Later duplicate', kept: true },
    { a: 'nonconformity:anchor-2', question: 'Second fixture', kept: true, source: 'synthetic', kind: 'content' },
    { a: 'rejected', question: 'Rejected fixture', kept: false },
    { a: 'truthy', question: 'Truthy fixture', kept: 1 },
    { a: 'missing-kept', question: 'Missing kept fixture' },
    { a: 'filter', question: 'Filter fixture', kept: true, kind: 'filter' },
    { a: 'empty', question: '', kept: true },
    { a: 'not-string', question: 42, kept: true },
  ];
  assert.deepEqual(readQuestions(`\n${jsonl(rows)}\n{torn\n`), [
    { caseKey: 'flywheel/anchor-1', question: 'First fixture', split: 'dev', relevant: ['anchor-1'] },
    { caseKey: 'flywheel/anchor-2', question: 'Second fixture', split: 'heldout', relevant: ['anchor-2'] },
  ]);
});

test('kept real content uses its question ID and explicit split, and excludes filters', () => {
  const rows = [
    { id: 'real-1', a: 'other-anchor', source: 'real', kind: 'content', kept: true, question: 'Real fixture', split: 'heldout', relevant: ['record1'] },
    { id: 'real-2', source: 'real', kept: true, question: 'No split fixture', relevant: ['record1'] },
    { id: 'real-filter', source: 'real', kind: 'filter', kept: true, question: 'Filter fixture', filterCheck: { supported: true } },
    { id: 'real-rejected', source: 'real', kept: false, question: 'Rejected fixture', relevant: ['record1'] },
  ];
  assert.deepEqual(readQuestions(jsonl(rows)), [
    { caseKey: 'flywheel/real-1', question: 'Real fixture', split: 'heldout', relevant: ['record1'] },
    { caseKey: 'flywheel/real-2', question: 'No split fixture', relevant: ['record1'] },
  ]);
});

test('the pool counts the row relevant ids as grade 3 on top of the labels file', () => {
  const labels = { 'flywheel/q': { pooled: { g: 3 }, other: { g: 1 } } };
  assert.deepEqual(poolFor({ caseKey: 'flywheel/q', relevant: ['anchor'] }, labels), { pooled: { g: 3 }, other: { g: 1 }, anchor: { g: 3 } });
  assert.deepEqual(poolFor({ caseKey: 'flywheel/none' }, labels), {});
});

test('split summaries score only cases with the corresponding split', () => {
  const makeCase = (split, hit, ms) => ({
    ...(split == null ? {} : { split }),
    ...Object.fromEntries(['bm25', 'trgm', 'trgmWord'].map((method) => [method, { top30: hit, top200: hit, unlabeled200: 2 }])),
    ms: { bm25: ms, trgm: ms, trgmWord: ms },
  });
  const summary = summarizeBySplit([makeCase('dev', true, 1), makeCase('dev', false, 2), makeCase('heldout', false, 3), makeCase(null, true, 4)]);
  assert.deepEqual(Object.keys(summary), ['dev', 'heldout']);
  for (const method of ['bm25', 'trgm', 'trgmWord']) {
    assert.equal(summary.dev[method].cases, 2);
    assert.deepEqual(summary.dev[method].top30, { hits: 1, rate: 0.5 });
    assert.deepEqual(summary.dev[method].top200, { hits: 1, rate: 0.5 });
    assert.equal(summary.dev[method].unlabeled200, 4);
    assert.equal(summary.dev[method].p95Ms, 2);
    assert.equal(summary.heldout[method].cases, 1);
    assert.deepEqual(summary.heldout[method].top30, { hits: 0, rate: 0 });
  }
  assert.deepEqual(summarizeBySplit([]), {});
});
