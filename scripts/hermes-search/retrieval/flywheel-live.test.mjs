import test from 'node:test';
import assert from 'node:assert/strict';
import { LOSS_STAGES, lossStage, relevantIds } from './flywheel-live.mjs';

const kept = { a: 'nonconformity:a1', b: 'nonconformity:b1', grades: { dgx: { a: 3, b: 1 }, jev: { a: 3, b: 2 } } };

test('relevant ids are the anchor, plus the near miss only when both graders confirm it', () => {
  assert.deepEqual(relevantIds(kept), ['a1']);
  assert.deepEqual(relevantIds({ ...kept, grades: { dgx: { a: 3, b: 3 }, jev: { a: 3, b: 3 } } }), ['a1', 'b1']);
  assert.deepEqual(relevantIds({ ...kept, grades: { dgx: { a: 3, b: 3 }, jev: { a: 3, b: null } } }), ['a1']);
});

test('the loss stage follows where the anchor was lost', () => {
  const relevant = ['a1'];
  assert.equal(lossStage({ relevant, outcome: 'answer', shown: ['nonconformity:a1'], candidates: ['a1'], judged: 30 }), null);
  assert.equal(lossStage({ relevant, outcome: 'answer', shown: ['x9'], candidates: ['x9', 'a1'], judged: 30 }), 'other_shown');
  assert.equal(lossStage({ relevant, outcome: 'no_result', shown: [], candidates: ['x1', 'a1'], judged: 30 }), 'judge_rejected');
  // The anchor ranked below the judged depth counts as outside the pool.
  assert.equal(lossStage({ relevant, outcome: 'no_result', shown: [], candidates: ['x1', 'a1'], judged: 1 }), 'not_in_pool');
  assert.equal(lossStage({ relevant, outcome: 'no_result', shown: [], candidates: [], judged: 30 }), 'not_in_pool');
  assert.equal(lossStage({ relevant, outcome: 'clarification', shown: [], candidates: [], judged: 30 }), 'status');
  assert.equal(lossStage({ relevant, outcome: 'out_of_scope', shown: [], candidates: [], judged: 30 }), 'status');
  assert.equal(lossStage({ relevant, outcome: 'unavailable', shown: [], candidates: [], judged: 30 }), 'status');
  assert.ok(LOSS_STAGES.includes('judge_rejected'));
});
