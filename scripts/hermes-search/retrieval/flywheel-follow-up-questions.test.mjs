import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleFollowUpQuestions } from './flywheel-follow-up-questions.mjs';
import { checkSyntheticFollowUp } from './flywheel-follow-up-check.mjs';
import { expectedFilterResults } from './flywheel-filter-check.mjs';
import { createRandom } from './flywheel-seeds.mjs';
import { questionSet } from './flywheel-gate.mjs';
import { proposeLearnedQueries, evaluateCandidates } from './flywheel-learn.mjs';
import { comparePlannerVersions } from './flywheel-planner-version.mjs';
import { collectShownPairs } from './flywheel-shown-labels.mjs';

const catalog = { id: 'test', fields: [{ key: 'department', role: 'organization' }, { key: 'date', role: 'date' }] };
const records = [
  { id: 'a', department: '機械課', date: '2026-10-02' },
  { id: 'b', department: '機械課', date: '2026-11-01' },
  { id: 'c', department: '組立課', date: '2026-10-03' },
  { id: 'd', department: '品質課', date: '2025-12-01' },
];
const first = { id: 'f-first', kind: 'filter', seed: { template: 'recent' }, filterCheck: { ok: true },
  live: { shown: ['b', 'a'], plan: { filters: [{ field: 'department', op: 'eq', values: ['機械課'] }], semanticQuery: '', sort: 'recent', limit: 5 } } };
const sample = (extra = {}) => sampleFollowUpQuestions({ firstTurns: [first], records, catalog, count: 100,
  now: new Date('2026-11-08T14:00:00Z'), random: createRandom(42), ...extra });
const check = (question, live) => checkSyntheticFollowUp({ question, live, records, catalog });
const goodLive = question => ({ plan: question.expected.plan, outcome: 'answer', followUpAction: 'wrong-diagnostic',
  shown: expectedFilterResults({ plan: question.expected.plan, records, catalog }).expectedIds });

test('seeded sampling is deterministic with stable night ids, bounded and immutable', () => {
  const before = structuredClone(first);
  const rows = sample();
  assert.deepEqual(rows, sample());
  assert.notDeepEqual(rows, sample({ random: createRandom(43) }));
  assert.equal(rows.length, 7);
  assert.equal(sample({ count: 3 }).length, 3);
  assert.equal(sample({ count: 0 }).length, 0);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.ok(rows.every(row => /^fu-[a-f0-9]{16}$/u.test(row.id) && row.firstTurnId === first.id));
  assert.deepEqual(rows, sample({ now: new Date('2026-11-08T19:00:00Z') }));
  assert.deepEqual(first, before);
});

test('all four actions calculate expected results and carry the original session', () => {
  for (const row of sample()) {
    assert.deepEqual(row.previousPlan, first.live.plan);
    assert.deepEqual(row.previousShown, first.live.shown);
    if (row.action === 'count') { assert.equal(row.expected.matchedCount, 2); continue; }
    const live = goodLive(row);
    assert.equal(check(row, live).ok, true);
    assert.equal(check(row, live).chosenAction, 'wrong-diagnostic');
    if (row.action === 'add') {
      assert.deepEqual(live.shown, row.seed.template === 'last_month' ? ['a'] : ['b', 'a']);
      assert.equal(row.expected.plan.filters.length, 2);
    }
    if (row.action === 'replace') {
      assert.notEqual(row.seed.value, '機械課');
      assert.deepEqual(row.expected.plan.filters[0].values, [row.seed.value]);
      assert.equal(live.shown.length, 1);
    }
    if (row.action === 'drop') { assert.deepEqual(live.shown, ['b', 'c', 'a', 'd']); assert.deepEqual(row.expected.plan.filters, []); }
  }
});

test('plan checks precede shown checks, normalize values and ignore filter ordering', () => {
  const question = sample().find(row => row.action === 'add');
  const live = structuredClone(goodLive(question));
  live.plan.filters.reverse();
  live.plan.filters[1].values = live.plan.filters[1].values.map(value => `　${value}　`);
  assert.equal(check(question, live).ok, true);
  live.plan.limit = 3;
  assert.equal(check(question, live).planOk, false);
  assert.equal(check(question, live).shownOk, null);
  assert.equal(check(question, live).reason, 'follow_up_plan_mismatch');
  const wrong = goodLive(question); wrong.shown = ['d'];
  assert.equal(check(question, wrong).reason, 'filter_mismatch');
  assert.equal(check(question, { ...goodLive(question), outcome: 'failed' }).ok, false);
});

test('count requires count outcome and exact resultCount, including zero', () => {
  const question = sample().find(row => row.action === 'count');
  assert.equal(check(question, { outcome: 'count', resultCount: 2 }).ok, true);
  for (const live of [{ outcome: 'count', resultCount: 3 }, { outcome: 'answer', resultCount: 2 }, { outcome: 'count' }]) {
    assert.equal(check(question, live).reason, 'count_mismatch');
  }
  assert.equal(check({ ...question, expected: { matchedCount: 0 } }, { outcome: 'count', resultCount: 0 }).ok, true);
});

test('failed first turns are excluded; diagnostics explicitly record unsupported', () => {
  assert.deepEqual(sample({ firstTurns: [{ ...first, filterCheck: { ok: false } }] }), []);
  const question = { ...sample()[0], seed: { firstTurnMismatch: true } };
  assert.equal(check(question, null).supported, false);
  assert.equal(check(question, null).reason, 'first_turn_mismatch');
  assert.deepEqual(sample({ firstTurns: [{ ...first, seed: { breakdown: 'cause' } }] }), []);
  for (const template of ['count3', 'count5', 'last_month']) {
    assert.ok(sample({ firstTurns: [{ ...first, seed: { template } }] }).every(row => row.action !== 'add'));
  }
});

test('synthetic follow-ups are excluded from gate, learning, shown labels and planner comparison', async () => {
  const rows = sample().map(row => ({ ...row, kind: 'follow_up', source: 'synthetic', kept: true, a: 'a', relevant: ['a'], live: { shown: ['a'] } }));
  assert.deepEqual(questionSet(rows), []);
  assert.deepEqual(proposeLearnedQueries({ rows, night: '2026-11-08' }), []);
  await evaluateCandidates({ questions: rows, scoreBaseline: () => assert.fail(), scoreCandidate: () => assert.fail() });
  assert.deepEqual(collectShownPairs({ questions: rows, runs: [{ cases: rows.map(row => ({ id: row.id, shown: ['a'] })) }] }), []);
  const compared = comparePlannerVersions({ questions: rows, baselineRows: rows, candidateRows: rows });
  assert.equal(compared.affected, 0);
  assert.equal(compared.comparison.dev.n, 0);
});
