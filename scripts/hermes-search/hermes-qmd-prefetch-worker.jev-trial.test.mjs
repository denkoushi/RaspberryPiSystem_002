import assert from 'node:assert/strict';
import test from 'node:test';

import { TrialWorker } from './hermes-qmd-prefetch-worker.mjs';
import { HERMES_JEV_TRIAL_CONTRACT, syntheticConfirmationPending } from './hermes-jev-trial-fixture.mjs';

test('worker carries pending confirmation through to the existing search query', async () => {
  const searched = [];
  const worker = new TrialWorker({
    jevEnabled: true,
    intentEvaluator: async ({ request, relatedHistory, confirmationPending }) => {
      if (!confirmationPending) {
        assert.deepEqual(relatedHistory, []);
        return { requiresClarification: true, relation: 'new_request', action: 'find_or_list' };
      }
      assert.deepEqual(relatedHistory, [{ role: 'assistant', content: HERMES_JEV_TRIAL_CONTRACT.confirmationQuestion }]);
      return {
        requiresClarification: false,
        relation: 'confirmation_reply',
        action: 'provide_missing_value',
        confirmationResolution: {
          canProceed: true,
          confirmedInfo: { target: '架空対象A' },
          nextPending: null
        },
        request
      };
    }
  });
  worker.qmd = {
    snapshot: { records: [] },
    search: async (question) => { searched.push(question); return { status: 'no_results' }; }
  };
  worker.runtime = { snapshot: { count: 0 } };

  const first = await worker.answer(HERMES_JEV_TRIAL_CONTRACT.syntheticInitialRequest);
  assert.equal(first.status, 'clarification');
  assert.equal(first.confirmationPending.question, HERMES_JEV_TRIAL_CONTRACT.confirmationQuestion);
  assert.equal(searched.length, 0);

  const second = await worker.answer(HERMES_JEV_TRIAL_CONTRACT.syntheticReply, first.session);
  assert.equal(second.status, 'completed');
  assert.deepEqual(searched, [`${HERMES_JEV_TRIAL_CONTRACT.syntheticInitialRequest} ${HERMES_JEV_TRIAL_CONTRACT.syntheticResolvedCondition}`]);
});

test('worker returns without searching when JEV fails', async () => {
  const worker = new TrialWorker({ jevEnabled: true, intentEvaluator: async () => { throw new Error('synthetic connection failure'); } });
  let searchCalled = false;
  worker.qmd = { snapshot: { records: [] }, search: async () => { searchCalled = true; return { status: 'no_results' }; } };
  worker.runtime = { snapshot: { count: 0 } };
  const result = await worker.answer(HERMES_JEV_TRIAL_CONTRACT.syntheticInitialRequest);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.mode, 'jev_unavailable');
  assert.equal(searchCalled, false);
});

test('JEV remains disabled on the existing worker path by default', async () => {
  const searched = [];
  const worker = new TrialWorker({ jevEnabled: false, intentEvaluator: async () => { throw new Error('must not evaluate'); } });
  worker.qmd = {
    snapshot: { records: [] },
    search: async (question) => { searched.push(question); return { status: 'no_results' }; }
  };
  worker.runtime = { snapshot: { count: 0 } };
  const result = await worker.answer('業務対象の記録を確認したい');
  assert.equal(result.status, 'completed');
  assert.deepEqual(searched, ['業務対象の記録を確認したい']);
});

test('worker forwards the existing session to the real-record classifier', async () => {
  let received;
  const worker = new TrialWorker({
    recordClassifier: {
      answer: async (question, conversation) => {
        received = { question, conversation };
        return { status: 'clarification', answer: '確認が必要です。', recordIds: [], elapsedMs: 0 };
      },
      metrics: () => ({})
    }
  });
  worker.runtime = { snapshot: { count: 2 } };
  const result = await worker.answer('続きの質問', {
    pending: { request: '前の質問' },
    searchRequest: '前の質問',
    jevDialogue: [{ role: 'assistant', content: '追加条件を指定してください。' }],
  });
  assert.equal(result.status, 'clarification');
  assert.deepEqual(received, {
    question: '続きの質問',
    conversation: {
      relatedHistory: [{ role: 'assistant', content: '追加条件を指定してください。' }],
      confirmationPending: { request: '前の質問' },
      searchRequest: '前の質問',
    }
  });
});
