import test from 'node:test';
import assert from 'node:assert/strict';
import { planStage, scoreRun } from './stage-score.mjs';
import { execute, rrfCombine } from './executor.mjs';
import { QUERY_PLAN_SCHEMA } from './query-plan.mjs';

test('planStage keeps filter values, a date range, and recent sort', () => {
  const stage = planStage({
    filters: [
      { field: 'originDepartmentName', op: 'eq', values: ['North Shop'] },
      { field: 'discoveredOn', op: 'between', values: ['2024-02-01', '2024-01-01'] },
    ],
    sort: { field: 'discoveredOn', direction: 'desc' },
    limit: 2,
    diagnostics: { contentDecision: { final: true }, limitExplicit: true, scope: 'records' },
  }, { dateField: 'discoveredOn' });
  assert.equal(stage.outOfScope, false);
  assert.deepEqual(stage.filters, { originDepartmentName: ['North Shop'] });
  assert.deepEqual(stage.date, { from: '2024-01-01', to: '2024-02-01' });
  assert.equal(stage.sortRecent, true);
  assert.equal(stage.limit, 2);
  assert.equal(stage.hasContent, true);
});

test('stage score reports slot accuracy and candidate hit rates from synthetic ids', () => {
  const gold = [{
    id: 'c1',
    category: 'synthetic',
    question: 'qx',
    expect: 'answer',
    slots: {
      outOfScope: false,
      filters: { shop: ['North'] },
      date: null,
      sortRecent: true,
      limit: 1,
      hasContent: true,
    },
    targetIds: ['t1'],
    targetAll: true,
  }];
  const run = {
    cases: [{
      id: 'c1',
      status: 'answer',
      returned: 1,
      totalMs: 10,
      stage: gold[0].slots,
      candidateIds: ['other', 't1'],
      finalIds: ['t1'],
    }],
  };
  const scored = scoreRun(gold, run);
  assert.equal(scored.all.n, 1);
  assert.equal(scored.all.allSlots, 1);
  assert.equal(scored.all.status, 1);
  assert.equal(scored.all.recall15, 1);
  assert.equal(scored.all.recall50, 1);
  assert.equal(scored.all.precision, 1);
  assert.equal(scored.all.finalHit, 1);
  assert.equal(scored.categories.synthetic.n, 1);
});

test('rrfCombine and stage dump keep pre-relevance ids without changing the lexical top', async () => {
  assert.deepEqual(rrfCombine([{ id: 'a' }], [{ id: 'b' }, { id: 'a' }]).map((item) => item.id)[0], 'a');
  const records = [
    { id: 'hit', condition: 'qxrare marker' },
    { id: 'miss', condition: 'other note' },
  ];
  const executed = await execute({
    schema: QUERY_PLAN_SCHEMA,
    sources: ['nonconformity'],
    filters: [],
    semanticQuery: 'qxrare',
    sort: 'relevance',
    limit: 1,
    display: ['condition'],
    unresolved: [],
  }, {
    records,
    bodyFields: ['condition'],
    stageDump: true,
  });
  assert.equal(executed.results[0].recordId, 'hit');
  assert.equal(executed.candidateIds[0], 'hit');
  assert.ok(executed.candidateIds.length <= 50);
});
