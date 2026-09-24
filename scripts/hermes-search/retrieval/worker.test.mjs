import test from 'node:test';
import assert from 'node:assert/strict';
import { records } from './fixtures/synthetic-records.mjs';
import { loadNonconformityCatalog, fieldsWithRole } from './catalog.mjs';
import { prepareLexicalCorpus } from './executor.mjs';
import { buildValueIndex } from './value-index.mjs';
import {
  WORKER_PREFIX,
  completeRequest,
  createRetrievalAnswering,
  dispatchWorkerRequest,
  encodeWorkerLine,
  failureDiagnostic,
  noResultAnswer,
  readyPayload,
} from './worker.mjs';

const catalog = loadNonconformityCatalog();
const valueIndex = buildValueIndex(records, catalog);
const lexicalCorpus = prepareLexicalCorpus(records, fieldsWithRole(catalog, 'body'));

function plannerAnswers({ content = false, term = 'v0', sort = 'recent', limit = '2', turn = null } = {}) {
  const answers = {
    sort: { type: 'choice', choice: sort },
    limit: { type: 'choice', choice: limit },
    content: { type: 'noul', noul: content ? 0.95 : 0.1 },
  };
  if (term) answers.term_0 = { type: 'choice', choice: term };
  if (turn) answers.turn = { type: 'choice', choice: turn };
  return { answers };
}

function answeringWith(evaluate) {
  return createRetrievalAnswering({
    records,
    catalog,
    valueIndex,
    lexicalCorpus,
    evaluate,
    snapshotCount: records.length,
  });
}

test('worker protocol returns original field text and keeps the previous plan', async () => {
  const plannerRequests = [];
  const evaluate = async (input) => {
    if (input.questions.candidate_0) {
      const answers = {};
      for (const [key, question] of Object.entries(input.questions)) {
        const body = String(question.instructions).split('記録本文:\n')[1] ?? '';
        answers[key] = { type: 'noul', noul: body.includes('surface scratch') ? 0.9 : 0.1 };
      }
      return { answers };
    }
    plannerRequests.push(input.state.request);
    const content = String(input.state.request).includes('surface scratch');
    return plannerAnswers({
      content,
      limit: content ? '5' : '2',
      turn: input.questions.turn ? 'refine' : null,
    });
  };
  const answering = answeringWith(evaluate);
  const content = await completeRequest(answering, {
    type: 'request',
    requestId: 'req-content',
    question: 'North Shopのsurface scratchを見せて',
  });
  assert.equal(content.stage, 'completed');
  assert.equal(content.workerRequestId, 'req-content');
  assert.equal(content.result.status, 'completed');
  assert.equal(content.result.recordIds.length, 1);
  assert.equal(content.result.answer.includes('不適合内容:   surface scratch  '), true);
  assert.match(content.result.answer, /見つかった件数は、指定された件数より少ないです。/u);
  assert.equal(typeof content.result.elapsedMs, 'number');
  assert.equal(content.elapsedMs, content.result.elapsedMs);
  assert.equal(content.result.session.previousPlan.semanticQuery.includes('surface'), true);

  const counted = await completeRequest(answering, {
    type: 'request',
    requestId: 'req-count',
    question: 'North Shopの最近の記録を2件見せて',
  });
  assert.equal(counted.result.status, 'completed');
  assert.equal(counted.result.recordIds.length, 2);
  assert.match(counted.result.answer, /不適合内容: paint drip/u);
  assert.doesNotMatch(counted.result.answer, /不存在の証明/u);

  const follow = await completeRequest(answering, {
    type: 'request',
    requestId: 'req-follow',
    question: '1件に絞って',
    session: counted.result.session,
  });
  assert.equal(follow.result.status, 'completed');
  assert.match(plannerRequests.at(-1), /previous_plan/u);
  assert.equal(follow.result.session.previousPlan.filters.length > 0, true);

  const line = encodeWorkerLine(content);
  assert.equal(line.startsWith(WORKER_PREFIX), true);
  assert.equal(line.endsWith('\n'), true);
  const ready = readyPayload({ snapshotCount: records.length, snapshotId: 'synthetic' });
  assert.equal(ready.workerReady, true);
  assert.equal(ready.runtime.snapshot.count, records.length);
});

test('an unresolved term asks for candidates and a content miss returns the fixed no-result sentence', async () => {
  const evaluate = async (input) => {
    if (input.questions.candidate_0) {
      const answers = {};
      for (const key of Object.keys(input.questions)) answers[key] = { type: 'noul', noul: 0.1 };
      return { answers };
    }
    if (String(input.state.request).includes('qxrare')) {
      return plannerAnswers({ content: false, term: 'invented-shop', limit: '2' });
    }
    return plannerAnswers({ content: false, limit: '2' });
  };
  const answering = answeringWith(evaluate);
  const empty = await completeRequest(answering, {
    type: 'request',
    requestId: 'req-none',
    question: 'North Shopのqxrareを2件見せて',
  });
  assert.equal(empty.result.status, 'clarification');
  assert.match(empty.result.answer, /North Shop/u);
  assert.deepEqual(empty.result.recordIds, []);

  const none = await completeRequest(answering, {
    type: 'request',
    requestId: 'req-missing',
    question: 'zzmissingphenomenonを見せて',
  });
  assert.equal(none.result.status, 'completed');
  assert.equal(none.result.answer, noResultAnswer(records.length));
  assert.equal(none.result.recordIds.length, 0);
});

test('request failures stay on the bounded diagnostic and omit the error text', async () => {
  const secret = 'super-secret-token';
  const answering = answeringWith(async () => {
    throw new Error(secret);
  });
  const failed = await completeRequest(answering, {
    type: 'request',
    requestId: 'req-fail',
    question: 'North Shopの最近の記録を2件見せて',
  });
  assert.equal(failed.workerError, 'trial worker request failed');
  assert.deepEqual(failed.failureDiagnostic, failureDiagnostic(new Error('x')));
  assert.equal(JSON.stringify(failed).includes(secret), false);
  const invalid = await completeRequest(answering, { type: 'note' });
  assert.equal(invalid.workerRequestId, null);
  assert.equal(invalid.failureDiagnostic.failureCode, 'unclassified');
});

test('worker requests run concurrently and can finish out of order', async () => {
  const evaluate = async (input) => {
    const slow = String(input.state.request).includes('slow-token');
    await new Promise((resolve) => setTimeout(resolve, slow ? 60 : 10));
    return plannerAnswers({ content: false, term: null, limit: '1' });
  };
  const answering = answeringWith(evaluate);
  const order = [];
  const slow = dispatchWorkerRequest(answering, {
    type: 'request',
    requestId: 'slow',
    question: 'slow-tokenを見せて',
  }, (payload) => order.push(payload.workerRequestId));
  const fast = dispatchWorkerRequest(answering, {
    type: 'request',
    requestId: 'fast',
    question: 'fast-tokenを見せて',
  }, (payload) => order.push(payload.workerRequestId));
  const [slowResult, fastResult] = await Promise.all([slow, fast]);
  assert.deepEqual(order, ['fast', 'slow']);
  assert.equal(slowResult.workerRequestId, 'slow');
  assert.equal(fastResult.workerRequestId, 'fast');
  assert.equal(slowResult.result.session.previousPlan.semanticQuery.includes('slow-token'), true);
  assert.equal(fastResult.result.session.previousPlan.semanticQuery.includes('fast-token'), true);
});

test('incremental corpus swaps the index and a failed refresh keeps the last data', async () => {
  const answering = answeringWith(async () => plannerAnswers({ content: false, term: null, limit: '1' }));
  const swapped = await answering.replaceCorpus({
    mode: 'incremental',
    asOf: '2026-09-24T00:30:00.000Z',
    records: [
      { id: 'rec-alpha', condition: 'surface scratch revised', nonconformityNo: 'SYN-001', discoveredOn: '2024-01-15', originDepartmentName: 'North Shop' },
      { id: 'rec-new', condition: 'synthetic added', nonconformityNo: 'SYN-009', discoveredOn: '2024-12-01', originDepartmentName: 'North Shop' },
    ],
  });
  assert.equal(swapped.ok, true);
  assert.equal(swapped.count, records.length + 1);
  const shown = await answering.answer('何件ですか');
  assert.match(shown.answer, /データ時点: 2026-09-24 09:30/);
  assert.equal(shown.dataAsOf, '2026-09-24 09:30');
  const boom = { id: 'rec-boom' };
  Object.defineProperty(boom, 'condition', { get() { throw new Error('refresh failed'); } });
  const warn = [];
  const original = console.warn;
  console.warn = (line) => warn.push(String(line));
  const failed = await answering.replaceCorpus({ mode: 'incremental', records: [boom] });
  console.warn = original;
  assert.equal(failed.ok, false);
  assert.equal(failed.count, records.length + 1);
  assert.match(warn[0], /count=\d+/);
  assert.equal(warn[0].includes('surface'), false);
  const again = await answering.answer('何件ですか');
  assert.equal(again.dataAsOf, '2026-09-24 09:30');
});
