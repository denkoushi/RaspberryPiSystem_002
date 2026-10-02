import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRADE_BATCH, bareId, buildPools, caseKey, gradeBatch, labelPools, parseSetArg, recordText, runCaseIds,
} from './graded-labels.mjs';
import { formatGradedTable, scoreCase, scoreGradedRun } from './graded-score.mjs';

const gold = [
  { id: 'c1', question: 'paint peeling', expect: 'answer', targetIds: ['nonconformity:t1'], judge: { anyOf: ['x'] } },
  { id: 'c2', question: 'rust', expect: 'answer', targetId: 't9', judge: { anyOf: ['x'] } },
  { id: 'c3', question: 'weather', expect: 'out_of_scope', judge: { anyOf: ['x'] } },
];

test('pools join gold targets, shown records, and the top candidates of every run', () => {
  const runs = [
    { cases: [{ id: 'c1', candidateIds: ['a', 'b', 'c', 'd'], finalIds: ['nonconformity:b'] }] },
    { cases: [{ id: 'c1', candidateIds: ['e', 'a'], ids: ['z'] }, { id: 'c2', ids: ['r1'] }] },
  ];
  const pools = buildPools([{ name: 'dev', gold, runs }], { depth: 2 });
  assert.deepEqual(pools[caseKey('dev', 'c1')].ids, ['t1', 'b', 'a', 'z', 'e']);
  assert.equal(pools['dev/c1'].question, 'paint peeling');
  // A run without a stage dump still contributes what it showed.
  assert.deepEqual(pools['dev/c2'].ids, ['t9', 'r1']);
  assert.deepEqual(pools['dev/c3'].ids, []);
  assert.equal(bareId('nonconformity:abc'), 'abc');
  assert.deepEqual(runCaseIds({ ids: ['nonconformity:x'] }), { candidates: [], shown: ['x'] });
  assert.deepEqual(parseSetArg('dev:gold.json:a.json,b.json'), { name: 'dev', gold: 'gold.json', runs: ['a.json', 'b.json'] });
  assert.throws(() => parseSetArg('dev:gold.json'), /--set/);
});

test('grading asks one choice per record and keeps only valid grades', async () => {
  assert.equal(recordText({ condition: ' scratch ', remarks: '' }, ['condition', 'remarks'], { condition: 'Phenomenon' }), 'Phenomenon: scratch');
  let seen = null;
  const graded = await gradeBatch({
    question: 'paint peeling',
    items: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }],
    evaluate: async (input) => {
      seen = input;
      return {
        answers: {
          c0: { type: 'choice', choice: 'g3', probabilities: { g3: 0.81, g2: 0.1, g1: 0.05, g0: 0.04 } },
          c1: { type: 'choice', choice: 'g0' },
          c2: { type: 'choice', choice: 'invented' },
        },
      };
    },
  });
  assert.deepEqual(Object.keys(seen.questions), ['c0', 'c1', 'c2']);
  assert.deepEqual(Object.keys(seen.questions.c0.criteria), ['g3', 'g2', 'g1', 'g0']);
  assert.match(seen.questions.c0.instructions, /paint peeling/u);
  assert.deepEqual(graded, { a: { g: 3, p: [0.04, 0.05, 0.1, 0.81] }, b: { g: 0, p: [0, 0, 0, 0] } });
});

test('labelling skips labelled pairs, batches the rest, and survives a failing batch', async () => {
  const ids = Array.from({ length: GRADE_BATCH + 3 }, (_, index) => `r${index}`);
  const recordsById = new Map(ids.map((id) => [id, { condition: `text ${id}` }]));
  const labels = { 'dev/c1': { r0: { g: 1, p: [] } } };
  const sizes = [];
  let calls = 0;
  const result = await labelPools({
    pools: { 'dev/c1': { question: 'q', ids: [...ids, 'missing-record'] } },
    labels,
    recordsById,
    bodyFields: ['condition'],
    concurrency: 1,
    retries: 1,
    sleep: async () => {},
    evaluate: async (input) => {
      calls += 1;
      const keys = Object.keys(input.questions);
      sizes.push(keys.length);
      if (keys.length === 2) throw new Error('connection failed');
      return { answers: Object.fromEntries(keys.map((key) => [key, { type: 'choice', choice: 'g2' }])) };
    },
  });
  // r0 is already labelled and the unknown record has no text, so 14 pairs remain: 12 and 2.
  assert.deepEqual(sizes, [GRADE_BATCH, 2, 2]);
  assert.equal(calls, 3);
  assert.deepEqual(result, { batches: 2, done: 1, failed: 1 });
  assert.equal(labels['dev/c1'].r0.g, 1);
  assert.equal(labels['dev/c1'].r5.g, 2);
  assert.equal(labels['dev/c1'].r13, undefined);
});

test('a case that showed nothing is attributed to the stage that lost it', () => {
  const item = { id: 'c1', expect: 'answer' };
  const labels = { a: { g: 3 }, b: { g: 2 }, c: { g: 0 } };
  const shown = scoreCase({ item, runCase: { status: 'answer', candidateIds: ['c', 'a'], finalIds: ['a', 'b', 'c', 'x'] }, labels });
  assert.deepEqual(shown.grades, { relevant: 1, similar: 1, lower: 1, unjudged: 1 });
  assert.equal(shown.relevantShown, true);
  assert.equal(shown.firstRelevantRank, 2);
  assert.equal(shown.loss, null);

  const none = (runCase, caseLabels = labels, judged = 15) => scoreCase({ item, runCase, labels: caseLabels, judged }).loss;
  assert.equal(none({ status: 'clarification', candidateIds: [], finalIds: [] }), 'status');
  assert.equal(none({ status: 'no_result', candidateIds: ['c'], finalIds: [] }, { c: { g: 1 } }), 'noRelevantLabelled');
  assert.equal(none({ status: 'no_result', candidateIds: ['c', 'b', 'a'], finalIds: [] }, labels, 2), 'notInPool');
  assert.equal(none({ status: 'no_result', candidateIds: ['c', 'b', 'a'], finalIds: [] }, labels, 3), 'judgeRejected');
  assert.equal(none({ status: 'no_result', ids: [] }), 'unknown');
});

test('a run is summarized over the cases that expect an answer', () => {
  const run = {
    cases: [
      { id: 'c1', status: 'answer', candidateIds: ['t1', 'a'], finalIds: ['t1', 'a'] },
      { id: 'c2', status: 'no_result', candidateIds: ['b', 't9'], finalIds: [] },
      { id: 'c3', status: 'out_of_scope', candidateIds: [], finalIds: [] },
    ],
  };
  const labels = { 'dev/c1': { t1: { g: 3 }, a: { g: 1 } }, 'dev/c2': { t9: { g: 3 }, b: { g: 0 } } };
  const { summary, cases } = scoreGradedRun({ setName: 'dev', gold, run, labels, judged: 15 });
  assert.equal(cases.length, 2);
  assert.deepEqual(summary, {
    cases: 2,
    answered: 1,
    relevantShown: 1,
    nothingShown: 1,
    shownGrades: { relevant: 1, similar: 0, lower: 1, unjudged: 0 },
    relevantInCandidates: { top15: 2, top30: 2, top50: 2 },
    losses: { judgeRejected: ['c2'] },
  });
  const table = formatGradedTable('dev:run.json', summary);
  assert.match(table, /a relevant record shown 1/u);
  assert.match(table, /lost \(a relevant record reached the judge and was not accepted\): 1 \[c2\]/u);
});
