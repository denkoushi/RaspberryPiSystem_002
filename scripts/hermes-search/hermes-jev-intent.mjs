import {
  ACTION_OPTIONS,
  BINARY_OPTIONS,
  CONFIRMATION_REPLY_OPTIONS,
  RELATION_OPTIONS,
  interpretUserIntent
} from './generic-intent-interpretation.mjs';
import { HERMES_JEV_TRIAL_CONTRACT, syntheticConfirmationPending } from './hermes-jev-trial-fixture.mjs';

const SCORED_OPERATIONS = new Set([
  'intent_relation', 'intent_action', 'intent_explicit_target', 'intent_resolved_reference',
  'confirmation_reply', 'intent_competing_interpretations'
]);

function questionFor({ question, options }) {
  return { type: 'choice', instructions: question, criteria: Object.fromEntries(options.map((option) => [option.id, option.description])) };
}

function placeholderScore(options) {
  const ids = options.map(({ id }) => id);
  return { option_ids: ids, probabilities: ids.map((_, index) => index === 0 ? 1 : 0) };
}

function choiceResult(answer, options) {
  if (!answer || answer.type !== 'choice' || typeof answer.choice !== 'string') throw new Error('Unexpected TypeSafe choice answer');
  return { option_ids: options.map(({ id }) => id), probabilities: options.map((option) => Number(answer.probabilities?.[option.id] ?? 0)), rawAnswer: answer };
}

function safeDialogue(relatedHistory) {
  if (!Array.isArray(relatedHistory)) throw new TypeError('JEV confirmation dialogue must be an array');
  return relatedHistory.map((item, index) => {
    if (!item || item.role !== 'assistant' || item.content !== HERMES_JEV_TRIAL_CONTRACT.confirmationQuestion) {
      throw new Error(`JEV confirmation dialogue[${index}] is not an allowlisted confirmation turn`);
    }
    return { role: 'assistant', content: HERMES_JEV_TRIAL_CONTRACT.confirmationQuestion };
  });
}

function safePending(pending) {
  if (pending === null || pending === undefined) return null;
  const expected = syntheticConfirmationPending(pending.confirmedInfo ?? {});
  if (pending.request !== expected.request || pending.question !== expected.question || pending.purpose !== expected.purpose) {
    throw new Error('JEV confirmation state is not the fixed synthetic trial state');
  }
  if (JSON.stringify(pending.requiredItems) !== JSON.stringify(expected.requiredItems)) throw new Error('JEV confirmation items are not allowlisted');
  const allowed = new Set(expected.requiredItems[0].candidates);
  const confirmedTarget = pending.confirmedInfo?.target;
  if (confirmedTarget !== undefined && !allowed.has(confirmedTarget)) throw new Error('JEV confirmedInfo contains an unapproved value');
  if (!Array.isArray(pending.unresolvedItems) || pending.unresolvedItems.some((id) => id !== 'target')) throw new Error('JEV unresolvedItems are not allowlisted');
  return expected;
}

export function buildJevState({ request, relatedHistory = [], confirmationPending = null } = {}) {
  if (typeof request !== 'string' || !request.trim()) throw new TypeError('JEV request must be non-empty');
  return { request, relatedHistory: safeDialogue(relatedHistory), confirmationPending: safePending(confirmationPending) };
}

async function defaultEvaluate(input) {
  const { experimental_evaluate: evaluate } = await import('ai');
  return evaluate(input);
}

export async function interpretWithJev({
  request,
  relatedHistory = [],
  confirmationPending = null,
  evaluateImplementation = defaultEvaluate,
  onDecision = () => {}
} = {}) {
  const state = buildJevState({ request, relatedHistory, confirmationPending });
  const collected = [];
  let operationIndex = 0;
  await interpretUserIntent({
    bridge: { score: (args) => { collected.push(args); return placeholderScore(args.options); } },
    request: state.request,
    relatedHistory: state.relatedHistory,
    confirmationPending: state.confirmationPending,
    onDecision: (decision) => {
      if (!SCORED_OPERATIONS.has(decision.operation)) return;
      const current = collected[operationIndex++];
      if (!current || current.operation) throw new Error(`Unable to associate JEV question with ${decision.operation}`);
      current.operation = decision.operation;
    }
  });
  if (!collected.length || operationIndex !== collected.length || collected.some((item) => !item.operation)) throw new Error('Unable to collect all JEV questions');
  const questions = {};
  for (const item of collected) {
    if (questions[item.operation]) throw new Error(`Duplicate JEV operation: ${item.operation}`);
    questions[item.operation] = questionFor(item);
  }
  const evaluated = await evaluateImplementation({ model: 'typesafe-ai/jev', state, questions, maxRetries: 0 });
  let resultIndex = 0;
  const result = await interpretUserIntent({
    bridge: { score: (args) => {
      const item = collected[resultIndex++];
      const answer = evaluated?.answers?.[item?.operation];
      if (!answer) throw new Error(`Missing batched JEV answer for ${item?.operation ?? 'unknown'}`);
      return choiceResult(answer, args.options);
    } },
    request: state.request,
    relatedHistory: state.relatedHistory,
    confirmationPending: state.confirmationPending,
    onDecision
  });
  if (resultIndex !== collected.length) throw new Error('JEV question count changed during replay');
  return { result, sent: { model: 'typesafe-ai/jev', state, questions } };
}

export { ACTION_OPTIONS, BINARY_OPTIONS, CONFIRMATION_REPLY_OPTIONS, RELATION_OPTIONS };
