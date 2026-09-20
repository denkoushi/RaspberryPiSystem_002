import assert from 'node:assert/strict';
import test from 'node:test';

import { interpretWithJev } from './hermes-jev-intent.mjs';
import { HERMES_JEV_TRIAL_CONTRACT, syntheticConfirmationPending } from './hermes-jev-trial-fixture.mjs';

function answerFor(operation, request, hasPending) {
  const choice = operation === 'intent_relation'
    ? (hasPending ? 'confirmation_reply' : 'new_request')
    : operation === 'intent_action'
      ? (hasPending ? 'provide_missing_value' : 'find_or_list')
      : operation === 'intent_explicit_target'
        ? (request.includes('架空対象A') || request.includes('架空対象B') ? 'yes' : 'no')
        : operation === 'intent_resolved_reference'
          ? (hasPending ? 'yes' : 'no')
          : operation === 'confirmation_reply'
            ? 'answer_to_requested_information'
            : 'no';
  return {
    type: 'choice',
    choice,
    probabilities: Object.fromEntries([
      ['new_request', 0], ['confirmation_reply', 0], ['find_or_list', 0], ['provide_missing_value', 0],
      ['yes', 0], ['no', 0], ['answer_to_requested_information', 0], ['approval', 0], ['neither', 0]
    ].map(([id, value]) => [id, id === choice ? 1 : value]))
  };
}

test('fixed synthetic connection payload excludes display history and resolves the condition', async () => {
  const sent = [];
  const evaluateImplementation = async (payload) => {
    sent.push(structuredClone(payload));
    return {
      answers: Object.fromEntries(Object.keys(payload.questions).map((operation) => [
        operation,
        answerFor(operation, payload.state.request, Boolean(payload.state.confirmationPending))
      ]))
    };
  };

  const initial = await interpretWithJev({
    request: HERMES_JEV_TRIAL_CONTRACT.syntheticInitialRequest,
    relatedHistory: [],
    confirmationPending: null,
    evaluateImplementation
  });
  assert.equal(initial.result.requiresClarification, true);
  assert.equal(sent.length, 1);

  const pending = syntheticConfirmationPending();
  const reply = await interpretWithJev({
    request: HERMES_JEV_TRIAL_CONTRACT.syntheticReply,
    relatedHistory: [{ role: 'assistant', content: pending.question }],
    confirmationPending: pending,
    evaluateImplementation
  });
  assert.equal(reply.result.confirmationResolution.canProceed, true);
  assert.equal(reply.result.confirmationResolution.confirmedInfo.target, '架空対象A');
  assert.equal(sent[1].state.confirmationPending.question, HERMES_JEV_TRIAL_CONTRACT.confirmationQuestion);
  assert.deepEqual(sent[1].state.relatedHistory, [{ role: 'assistant', content: HERMES_JEV_TRIAL_CONTRACT.confirmationQuestion }]);
  assert.ok(!JSON.stringify(sent).includes(HERMES_JEV_TRIAL_CONTRACT.displayOnlyOriginalText));
  assert.ok(!JSON.stringify(sent).includes('表示専用'));
  assert.ok(!JSON.stringify(sent).includes('検索結果'));
});

test('unallowlisted confirmation dialogue and confirmed values are rejected before evaluation', async () => {
  const evaluateImplementation = async () => { throw new Error('must not evaluate'); };
  await assert.rejects(
    () => interpretWithJev({
      request: HERMES_JEV_TRIAL_CONTRACT.syntheticReply,
      relatedHistory: [{ role: 'assistant', content: '表示された原文をそのまま送る' }],
      confirmationPending: syntheticConfirmationPending({ target: '業務情報' }),
      evaluateImplementation
    }),
    /allowlisted|unapproved/
  );
});
