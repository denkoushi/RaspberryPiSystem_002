import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { records } from './fixtures/synthetic-records.mjs';
import { deriveCatalog, loadCatalog, loadNonconformityCatalog, fieldsWithRole } from './catalog.mjs';
import { validateSourceDefinition, sourceDefinitions } from '../hermes-source-definition.mjs';
import { authorizedRecords } from './corpus.mjs';
import { prepareLexicalCorpus } from './executor.mjs';
import { buildValueIndex } from './value-index.mjs';
import {
  WORKER_PREFIX,
  completeRequest,
  createRetrievalAnswering,
  dispatchWorkerRequest,
  encodeWorkerLine,
  enrichmentAttachEnabled,
  failureDiagnostic,
  formatCoverageNotice,
  loadEnrichmentById,
  loadLearnedQueriesById,
  loadRetrievalResources,
  noOtherAnswer,
  noResultAnswer,
  readyPayload,
} from './worker.mjs';

const catalog = loadNonconformityCatalog();
const valueIndex = buildValueIndex(records, catalog);
const lexicalCorpus = prepareLexicalCorpus(records, fieldsWithRole(catalog, 'body'));

const mixedCatalog = loadCatalog(['nonconformity', 'knowledge_procedure']);
const mixedRecords = authorizedRecords([
  { kind: 'nonconformity', id: 'shared', nonconformityNo: 'N1', partNumber: 'N', condition: 'ブラケット溶接の不適合', discoveredOn: '2026-10-01' },
  { kind: 'knowledge_procedure', id: 'shared', title: 'ブラケット溶接', partNumber: 'P', stepsText: 'ブラケット溶接の手順原文', cautionsText: '保護具を着用', publishedOn: '2026-10-02' },
], mixedCatalog);

function mixedEvaluate(input) {
  const answers = {};
  for (const key of Object.keys(input.questions)) {
    if (key.startsWith('candidate_')) answers[key] = { type: 'noul', noul: 0.95 };
    else if (key.startsWith('field_')) answers[key] = { type: 'choice', choice: 'none' };
  }
  answers.scope = { type: 'choice', choice: 'knowledge_procedure' };
  answers.content = { type: 'noul', noul: 0.95 };
  answers.sort = { type: 'choice', choice: 'relevance' };
  answers.limit = { type: 'choice', choice: 'unspecified' };
  return Promise.resolve({ answers });
}

function fixedPlanner(sources, overrides = {}) {
  return { plan: async () => ({ plan: {
    schema: 'hermes-query-plan/v1', sources, filters: [], semanticQuery: 'ブラケット溶接',
    sort: 'relevance', limit: 2, display: mixedCatalog.flatMap(entry => entry.fields.map(field => field.key)),
    unresolved: [], diagnostics: { limitExplicit: false }, ...overrides,
  } }) };
}

const adminDefinition = validateSourceDefinition(JSON.parse(readFileSync(new URL('./fixtures/admin-source.json', import.meta.url), 'utf8')), 'synthetic_admin');
const restrictedCatalog = [...mixedCatalog, deriveCatalog(adminDefinition)];
const restrictedRecords = [...mixedRecords, { id: 'private', sourceId: adminDefinition.id,
  title: '管理専用記録', partNumber: 'SECRET-FACET', stepsText: 'ブラケット溶接: 管理者だけの合成本文' }];

test('viewer and admin see only their sources in planner inputs, execution and stage dumps', async () => {
  const inputs = [];
  const planner = { plan: async (input) => {
    inputs.push(input);
    return { plan: { schema: 'hermes-query-plan/v1', sources: input.catalog.map(entry => entry.id),
      filters: [], semanticQuery: 'ブラケット溶接', sort: 'relevance', limit: 5,
      display: input.catalog.flatMap(entry => entry.fields.map(field => field.key)), unresolved: [] } };
  } };
  assert.equal(Object.hasOwn(sourceDefinitions, adminDefinition.id), false);
  const answering = createRetrievalAnswering({ records: restrictedRecords, catalog: restrictedCatalog, planner, evaluate: mixedEvaluate });
  const [viewer, admin] = await Promise.all([
    answering.answer('SECRET-FACET', null, { stageDump: true, principal: { kind: 'viewer' } }),
    answering.answer('all', null, { stageDump: true, principal: { kind: 'admin' } }),
  ]);
  assert.deepEqual(viewer.recordIds, ['nonconformity:shared', 'knowledge_procedure:shared']);
  assert.deepEqual(viewer.candidateIds, ['shared', 'shared']);
  assert.doesNotMatch(JSON.stringify(viewer), /private|管理専用|管理者だけ|管理者限定/u);
  assert.deepEqual(inputs[0].catalog, mixedCatalog);
  assert.deepEqual(Object.keys(inputs[0].valueIndex.values), ['nonconformity', 'knowledge_procedure']);
  assert.doesNotMatch(JSON.stringify(inputs[0].candidates), /SECRET-FACET/u);
  assert.deepEqual(admin.recordIds, ['nonconformity:shared', 'knowledge_procedure:shared', 'synthetic_admin:private']);
  assert.deepEqual(admin.candidateIds, ['shared', 'shared', 'private']);
  assert.match(admin.answer, /【管理者限定合成ソース】[\s\S]*管理者だけの合成本文/u);
  assert.deepEqual(inputs[1].valueIndex.values.synthetic_admin.partNumber, ['SECRET-FACET']);
  const follow = await answering.answer('all', admin.session, { principal: { kind: 'viewer' } });
  assert.equal(inputs.at(-1).previousPlan, null);
  assert.equal(inputs.at(-1).shownCount, 2);
  assert.doesNotMatch(JSON.stringify(follow), /private|SECRET-FACET/u);
  const legacy = await answering.answer('all', null, { stageDump: true });
  assert.deepEqual(legacy.recordIds, admin.recordIds);
  assert.deepEqual(legacy.candidateIds, admin.candidateIds);
});

test('visibility limits out-of-scope wording, no-result counts and planner-selected sources', async () => {
  const outside = createRetrievalAnswering({ records: restrictedRecords, catalog: restrictedCatalog,
    planner: fixedPlanner([], { diagnostics: { scope: 'out_of_scope' } }) });
  assert.equal((await outside.answer('weather', null, { principal: { kind: 'viewer' } })).answer,
    '不適合・手順書の検索に関する質問として解釈できませんでした。');
  assert.match((await outside.answer('weather', null, { principal: { kind: 'admin' } })).answer, /管理者限定合成ソース/u);
  const hidden = createRetrievalAnswering({ records: restrictedRecords, catalog: restrictedCatalog,
    planner: fixedPlanner(['synthetic_admin']) });
  const blocked = await hidden.answer('secret', null, { stageDump: true, principal: { kind: 'viewer' } });
  assert.deepEqual(blocked.recordIds, []);
  assert.equal(blocked.session.previousPlan, null);
  assert.doesNotMatch(JSON.stringify(blocked), /synthetic_admin|private|管理者/u);
  const noVisible = createRetrievalAnswering({ records: [restrictedRecords[2]], catalog: [restrictedCatalog[2]],
    planner: { plan: () => { throw new Error('empty catalog must not reach planner'); } } });
  const empty = await noVisible.answer('q', null, { principal: { kind: 'viewer' } });
  assert.deepEqual(empty.recordIds, []);
  assert.equal(empty.answer, '検索に関する質問として解釈できませんでした。');
  const miss = createRetrievalAnswering({ records: restrictedRecords, catalog: restrictedCatalog,
    planner: fixedPlanner(['nonconformity', 'knowledge_procedure']), evaluate: async () => ({ answers: {} }) });
  assert.match((await miss.answer('q', null, { principal: { kind: 'viewer' } })).answer, /検索対象2件/u);
});

test('ready and corpus updates report rounded worker memory and per-source counts', async (t) => {
  const mb = 1024 * 1024;
  t.mock.method(process, 'memoryUsage', () => ({ heapUsed: 12.34 * mb, rss: 56.78 * mb,
    external: 9.86 * mb, arrayBuffers: 3.21 * mb }));
  const ready = readyPayload({ records: mixedRecords, catalog: mixedCatalog, snapshotCount: 2, snapshotId: 'synthetic' });
  assert.deepEqual(ready.runtime.memory, { heapUsedMb: 12.3, rssMb: 56.8, externalMb: 9.9, arrayBuffersMb: 3.2,
    records: 2, bySource: { nonconformity: 1, knowledge_procedure: 1 } });
  const answering = createRetrievalAnswering({ records: [], catalog: mixedCatalog });
  const full = await answering.replaceCorpus({ mode: 'full', records: mixedRecords });
  assert.deepEqual(full.memory, ready.runtime.memory);
  const incremental = await answering.replaceCorpus({ mode: 'incremental', records: [{ ...mixedRecords[1], id: 'new' }] });
  assert.equal(incremental.memory.records, 3);
  assert.deepEqual(incremental.memory.bySource, { nonconformity: 1, knowledge_procedure: 2 });
  const removed = await answering.replaceCorpus({ mode: 'full', records: [mixedRecords[0]] });
  assert.deepEqual(removed.memory.bySource, { nonconformity: 1, knowledge_procedure: 0 });
});

test('worker emits memory at startup and after corpus updates over JSON lines', async () => {
  const { spawnSync } = await import('node:child_process');
  const worker = spawnSync(process.execPath, [new URL('./worker.mjs', import.meta.url).pathname], {
    env: { ...process.env, HERMES_RETRIEVAL_SOURCES: 'nonconformity,knowledge_procedure',
      HERMES_SEARCH_RECORD_SOURCE: '', HERMES_TRIAL_SNAPSHOT_PATH: '', HERMES_RETRIEVAL_ENRICHMENT_ENABLED: 'false',
      HERMES_RETRIEVAL_VECTOR_ENABLED: 'false', HERMES_RETRIEVAL_DENSE_PROVIDER: 'off', HERMES_RETRIEVAL_DENSE_INDEX_ENABLED: 'false' },
    input: `${JSON.stringify({ type: 'corpus', mode: 'full', records: mixedRecords })}\n`, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(worker.status, 0, worker.stderr);
  const lines = worker.stdout.trim().split('\n').filter(line => line.startsWith(WORKER_PREFIX)).map(line => JSON.parse(line.slice(WORKER_PREFIX.length)));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].workerReady, true);
  assert.equal(lines[0].runtime.memory.records, 0);
  assert.equal(lines[1].type, 'corpus');
  assert.equal(lines[1].ok, true);
  assert.equal(lines[1].memory.records, 2);
  assert.deepEqual(lines[1].memory.bySource, { nonconformity: 1, knowledge_procedure: 1 });
  assert.doesNotMatch(JSON.stringify(lines), /ブラケット|手順原文/u);
});

test('the real planner searches only published procedures with lexical retrieval', async () => {
  let vectorCalls = 0;
  const answering = createRetrievalAnswering({
    records: mixedRecords, catalog: mixedCatalog, evaluate: mixedEvaluate,
    dense: { queryEnabled: true, rank: () => { vectorCalls += 1; throw new Error('procedure must stay lexical'); } },
  });
  const result = await answering.answer('ブラケット溶接の手順書', null, { stageDump: true });
  assert.deepEqual(result.session.previousPlan.sources, ['knowledge_procedure']);
  assert.deepEqual(result.recordIds, ['knowledge_procedure:shared']);
  assert.deepEqual(result.candidateIds, ['shared']);
  assert.match(result.answer, /【手順書】\n手順書名: ブラケット溶接/u);
  assert.match(result.answer, /手順: ブラケット溶接の手順原文/u);
  assert.doesNotMatch(result.answer, /不適合内容/u);
  assert.equal(result.receipt.retriever, 'lexical');
  assert.equal(vectorCalls, 0);
  const recent = await answering.answer('最近のブラケット溶接の手順書');
  assert.deepEqual(recent.recordIds, ['knowledge_procedure:shared']);
  assert.deepEqual(recent.session.previousPlan.sort, { field: 'publishedOn', direction: 'desc' });
});

test('two-source plans concatenate source-labelled answers in plan order and keep bare candidateIds', async () => {
  const vectorSources = [];
  const answering = createRetrievalAnswering({
    records: mixedRecords, catalog: mixedCatalog, evaluate: mixedEvaluate,
    planner: fixedPlanner(['knowledge_procedure', 'nonconformity']),
    vector: async (_query, rows) => { vectorSources.push(rows.map(row => row.sourceId)); return { ok: true, orderedIds: [], scores: {} }; },
  });
  const result = await answering.answer('both', null, { stageDump: true });
  assert.deepEqual(result.recordIds, ['knowledge_procedure:shared', 'nonconformity:shared']);
  assert.deepEqual(result.candidateIds, ['shared', 'shared']);
  assert.match(result.answer, /【手順書】[\s\S]*手順: ブラケット溶接の手順原文[\s\S]*【不適合】[\s\S]*不適合内容: ブラケット溶接の不適合/u);
  assert.doesNotMatch(result.answer, /ほかにも該当する可能性/u);
  assert.deepEqual(vectorSources, [['nonconformity']]);
  const plain = await answering.answer('both');
  assert.equal('candidateIds' in plain, false);
});

test('source filters, date sorting and previously shown ids stay scoped to their source', async () => {
  const answering = createRetrievalAnswering({
    records: [...mixedRecords, { ...mixedRecords[1], id: 'p-new', publishedOn: '2026-10-03' }],
    catalog: mixedCatalog, evaluate: mixedEvaluate,
    planner: fixedPlanner(['knowledge_procedure', 'nonconformity'], {
      filters: [
        { source: 'knowledge_procedure', field: 'partNumber', op: 'eq', values: ['P'] },
        { source: 'nonconformity', field: 'partNumber', op: 'eq', values: ['N'] },
      ],
      semanticQuery: '', sort: { field: 'discoveredOn', direction: 'desc' },
      diagnostics: { excludeShown: true, contentDecision: { jev: false } },
    }),
  });
  const result = await answering.answer('other', { shownIds: ['nonconformity:shared'] }, { stageDump: true });
  assert.deepEqual(result.recordIds, ['knowledge_procedure:p-new', 'knowledge_procedure:shared']);
  assert.deepEqual(result.candidateIds, ['shared', 'p-new', 'shared']);
});

test('corpus refresh schedules only nonconformity vectors and single-source formatting stays plain', async () => {
  const schedules = [];
  const answering = createRetrievalAnswering({
    records: [], catalog: mixedCatalog, evaluate: mixedEvaluate,
    dense: { schedule: (rows, fields) => schedules.push({ rows, fields }) },
  });
  await answering.replaceCorpus({ mode: 'full', records: mixedRecords });
  assert.deepEqual(schedules[0].rows.map(row => row.sourceId), ['nonconformity']);
  assert.ok(schedules[0].fields.includes('condition'));
  assert.equal(schedules[0].fields.includes('stepsText'), false);
  const single = createRetrievalAnswering({ records: [mixedRecords[1]], catalog: loadCatalog(['knowledge_procedure']), evaluate: mixedEvaluate });
  assert.doesNotMatch((await single.answer('ブラケット溶接')).answer, /【/u);
  const outside = createRetrievalAnswering({ records: [], catalog: mixedCatalog, planner: fixedPlanner([], { diagnostics: { scope: 'out_of_scope' } }) });
  assert.equal((await outside.answer('weather')).answer, '不適合・手順書の検索に関する質問として解釈できませんでした。');
});

test('resource loading honors the default, configured sources and unknown-source startup failure', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const snapshot = path.join(mkdtempSync(path.join(tmpdir(), 'hermes-sources-')), 'snapshot.json');
  writeFileSync(snapshot, JSON.stringify({ records: mixedRecords }));
  const legacy = await loadRetrievalResources({ HERMES_SEARCH_RECORD_SOURCE: snapshot });
  assert.deepEqual(legacy.catalog.map(entry => entry.id), ['nonconformity']);
  const mixed = await loadRetrievalResources({ HERMES_SEARCH_RECORD_SOURCE: snapshot, HERMES_RETRIEVAL_SOURCES: 'nonconformity,knowledge_procedure' });
  assert.deepEqual(mixed.catalog, mixedCatalog);
  assert.equal(mixed.lexicalCorpus, null);
  assert.ok(legacy.lexicalCorpus);
  await assert.rejects(loadRetrievalResources({ HERMES_RETRIEVAL_SOURCES: 'missing' }), { message: 'unknown retrieval source: missing' });
  const startup = spawnSync(process.execPath, [new URL('./worker.mjs', import.meta.url).pathname], {
    env: { ...process.env, HERMES_RETRIEVAL_SOURCES: 'missing' }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(startup.status, 1);
  assert.doesNotMatch(startup.stdout, /workerReady/u);
  assert.match(startup.stdout, /trial worker startup failed/u);
});

// turn 'refine' keeps every previous condition, 'new_search' replaces them; `questions` are the
// planner's questions for this turn, so follow-up answers match what was asked.
function plannerAnswers({ content = false, term = 'v0', sort = 'recent', limit = '2', turn = null, questions = {} } = {}) {
  const answers = {
    sort: { type: 'choice', choice: sort },
    limit: { type: 'choice', choice: limit },
    content: { type: 'noul', noul: content ? 0.95 : 0.1 },
  };
  if (term) answers.term_0 = { type: 'choice', choice: term };
  for (const key of Object.keys(questions)) {
    if (key.startsWith('drop_')) answers[key] = { type: 'noul', noul: turn === 'refine' ? 0.1 : 0.9 };
    if (key.startsWith('add_')) answers[key] = { type: 'noul', noul: 0.1 };
  }
  if (questions.contentCarry) {
    answers.contentCarry = { type: 'choice', choice: content || turn !== 'refine' ? 'new' : 'same' };
  }
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
  const plannerHistories = [];
  const plannerStates = [];
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
    plannerHistories.push(input.state.relatedHistory);
    plannerStates.push(input.state);
    const content = String(input.state.request).includes('surface scratch');
    const answers = plannerAnswers({
      content,
      limit: content ? 'unspecified' : '2',
      turn: 'refine',
      questions: input.questions,
    }).answers;
    answers.scope = { type: 'choice', choice: 'nonconformity' };
    for (const [key, question] of Object.entries(input.questions)) {
      if (!key.startsWith('field_')) continue;
      const match = Object.entries(question.criteria).find(([, description]) => description !== 'この語は絞り込み条件にしない' && String(input.state.request).includes(description));
      answers[key] = { type: 'choice', choice: match ? match[0] : 'none' };
    }
    return { answers };
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
  assert.doesNotMatch(content.result.answer, /見つかった件数は、指定された件数より少ないです。/u);
  assert.equal(typeof content.result.elapsedMs, 'number');
  assert.equal(content.elapsedMs, content.result.elapsedMs);
  assert.equal(content.result.session.previousPlan.semanticQuery.includes('surface'), true);
  const receipt = content.result.receipt;
  assert.equal(receipt.schema, 'hermes-search-receipt/v1');
  assert.equal(receipt.outcome, 'answer');
  assert.equal(receipt.resultCount, 1);
  assert.equal(receipt.jev.turn, 'first');
  assert.equal(receipt.jev.questionVersion.startsWith('planner-questions-'), true);
  assert.equal(typeof receipt.jev.answers.content.noul, 'number');
  assert.equal(Object.values(receipt.jev.fields).every((field) => typeof field === 'string'), true);
  assert.equal(typeof receipt.elapsedMs, 'number');
  assert.doesNotMatch(JSON.stringify(receipt), /不適合内容/u);

  const counted = await completeRequest(answering, {
    type: 'request',
    requestId: 'req-count',
    question: 'North Shopの最近の記録を2件見せて',
  });
  assert.equal(counted.result.status, 'completed');
  assert.equal(counted.result.recordIds.length, 2);
  assert.match(counted.result.answer, /不適合内容: paint drip/u);
  assert.match(counted.result.answer, /該当3件のうち、新しい順に2件を表示しています。/u);
  assert.doesNotMatch(counted.result.answer, /不存在の証明/u);

  const follow = await completeRequest(answering, {
    type: 'request',
    requestId: 'req-follow',
    question: '1件に絞って',
    session: counted.result.session,
  });
  assert.equal(follow.result.status, 'completed');
  assert.equal(plannerRequests.at(-1), '1件に絞って');
  assert.equal(plannerHistories.at(-1).length, 0);
  assert.equal(plannerStates.at(-1).previous_plan.filters.length > 0, true);
  assert.equal('previous_plan' in plannerStates[0], false);
  assert.equal(follow.result.session.previousPlan.filters.length > 0, true);

  const line = encodeWorkerLine(content);
  assert.equal(line.startsWith(WORKER_PREFIX), true);
  assert.equal(line.endsWith('\n'), true);
  const ready = readyPayload({ records, catalog, snapshotCount: records.length, snapshotId: 'synthetic' });
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
    const base = plannerAnswers({ content: false, limit: '2' }).answers;
    base.scope = { type: 'choice', choice: 'nonconformity' };
    for (const key of Object.keys(input.questions)) {
      if (key.startsWith('field_')) base[key] = { type: 'choice', choice: 'none' };
    }
    return { answers: base };
  };
  const answering = answeringWith(evaluate);
  const empty = await completeRequest(answering, {
    type: 'request',
    requestId: 'req-none',
    question: 'North Shopのqxrareを2件見せて',
  });
  assert.equal(empty.result.status, 'completed');
  assert.deepEqual(empty.result.recordIds, []);
  assert.match(empty.result.answer, /一致する記録は見つかりませんでした/u);

  const none = await completeRequest(answering, {
    type: 'request',
    requestId: 'req-missing',
    question: 'zzmissingphenomenonを見せて',
  });
  assert.equal(none.result.status, 'completed');
  assert.deepEqual(none.result.recordIds, []);
  assert.match(none.result.answer, /一致する記録は見つかりませんでした/u);
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
  assert.equal(slowResult.result.session.previousPlan.semanticQuery, 'slow-tokenを見せて');
  assert.equal(fastResult.result.session.previousPlan.semanticQuery, 'fast-tokenを見せて');
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
  assert.equal(failed.memory.records, records.length + 1);
  assert.match(warn[0], /count=\d+/);
  assert.equal(warn[0].includes('surface'), false);
  const again = await answering.answer('何件ですか');
  assert.equal(again.dataAsOf, '2026-09-24 09:30');
});

test('coverage notice follows the known total, the sort, and an unknown floor', () => {
  assert.equal(
    formatCoverageNotice({ known: true, total: 19, shown: 5, order: 'date_desc' }),
    '該当19件のうち、新しい順に5件を表示しています。',
  );
  assert.equal(
    formatCoverageNotice({ known: true, total: 19, shown: 2, order: 'date_desc' }),
    '該当19件のうち、新しい順に2件を表示しています。',
  );
  assert.equal(formatCoverageNotice({ known: true, total: 3, shown: 3, order: 'date_desc' }), '');
  assert.equal(formatCoverageNotice(null), '');
  assert.equal(
    formatCoverageNotice({ known: false, total: null, floor: 15, shown: 5, order: 'relevance' }),
    '該当15件以上のうち、関連度の高い順に5件を表示しています。',
  );
  assert.equal(
    formatCoverageNotice({ known: false, total: null, floor: null, shown: 1, order: 'date_desc' }),
    'ほかにも該当する可能性があります。',
  );
  assert.equal(
    formatCoverageNotice({ known: true, total: 4, shown: 2, order: 'date_asc' }),
    '該当4件のうち、古い順に2件を表示しています。',
  );
});

test('a request for other records hides the ones already shown and says when none are left', async () => {
  const plannerQuestions = [];
  const evaluate = async (input) => {
    if (input.questions.candidate_0) {
      const answers = {};
      for (const [key, question] of Object.entries(input.questions)) {
        const body = String(question.instructions).split('記録本文:\n')[1] ?? '';
        answers[key] = { type: 'noul', noul: body.includes('surface scratch') ? 0.9 : 0.1 };
      }
      return { answers };
    }
    plannerQuestions.push(Object.keys(input.questions));
    const other = String(input.state.request).includes('ほか');
    const answers = plannerAnswers({ content: true, term: null, sort: 'relevance', limit: 'unspecified', turn: 'new_search', questions: input.questions }).answers;
    answers.scope = { type: 'choice', choice: 'nonconformity' };
    if (input.questions.excludeShown) answers.excludeShown = { type: 'noul', noul: other ? 0.9 : 0.1 };
    return { answers };
  };
  const answering = answeringWith(evaluate);
  const first = await completeRequest(answering, { type: 'request', requestId: 'r1', question: 'surface scratchの記録' });
  assert.equal(first.result.recordIds.length, 1);
  assert.deepEqual(first.result.session.shownIds, first.result.recordIds);
  assert.equal(plannerQuestions[0].includes('excludeShown'), false);

  const other = await completeRequest(answering, { type: 'request', requestId: 'r2', question: 'surface scratchはほかにある？', session: first.result.session });
  assert.equal(plannerQuestions[1].includes('excludeShown'), true);
  assert.deepEqual(other.result.recordIds, []);
  assert.match(other.result.answer, new RegExp(noOtherAnswer(1)));
  assert.equal(other.result.receipt.outcome, 'no_other');
  assert.deepEqual(other.result.session.shownIds, first.result.recordIds);

  const again = await completeRequest(answering, { type: 'request', requestId: 'r3', question: 'surface scratchの記録をもう一度', session: other.result.session });
  assert.deepEqual(again.result.recordIds, first.result.recordIds);
});

test('stored enrichment is attached only while enrichment is enabled', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const store = path.join(mkdtempSync(path.join(tmpdir(), 'enrichment-gate-')), 'store.jsonl');
  writeFileSync(store, `${JSON.stringify({
    schema: 'hermes-retrieval-enrichment/v1',
    recordId: 'rec-alpha',
    summary: 'note',
    queries: [],
    facets: { phenomenon: [], cause: [], process: [], part: [], treatment: [] },
  })}\n`);
  assert.equal(enrichmentAttachEnabled({}), false);
  assert.equal(enrichmentAttachEnabled({ HERMES_RETRIEVAL_ENRICHMENT_ENABLED: 'false' }), false);
  assert.equal(enrichmentAttachEnabled({ HERMES_RETRIEVAL_ENRICHMENT_ENABLED: 'true' }), true);
  // The store stays on disk when the flag is off; it is just not read.
  assert.equal(await loadEnrichmentById({ HERMES_RETRIEVAL_ENRICHMENT_STORE: store }), null);
  assert.equal(await loadEnrichmentById({ HERMES_RETRIEVAL_ENRICHMENT_ENABLED: 'false', HERMES_RETRIEVAL_ENRICHMENT_STORE: store }), null);
  const loaded = await loadEnrichmentById({ HERMES_RETRIEVAL_ENRICHMENT_ENABLED: 'true', HERMES_RETRIEVAL_ENRICHMENT_STORE: store });
  assert.equal(loaded.get('rec-alpha').summary, 'note');
});

test('learned queries load separately, normalize ids, select active rows and can be disabled', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { LEARNED_SCHEMA, learnedPath, writeLearned } = await import('./flywheel-learn.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'worker-learned-'));
  const store = path.join(dir, 'enrichment.jsonl');
  writeFileSync(store, JSON.stringify({ schema: 'hermes-retrieval-enrichment/v1', recordId: 'rec-alpha', summary: 'note', queries: ['existing'] }) + '\n');
  const file = learnedPath(dir);
  const row = { schema: LEARNED_SCHEMA, recordId: 'rec-alpha', query: 'learned wording', source: 'synthetic', from: 'rec-alpha', night: '2026-10-03', at: '2026-10-03T15:00:00Z' };
  await writeLearned(file, [{ ...row, state: 'active' }, { ...row, recordId: 'nonconformity:rec-alpha', state: 'active' },
    { ...row, query: 'pending', state: 'candidate' }, { ...row, query: 'wrong', state: 'rejected' },
    { ...row, recordId: 'new-record', query: 'new wording', state: 'active' }]);
  const env = { HERMES_FLYWHEEL_LEARNED_PATH: file, HERMES_RETRIEVAL_ENRICHMENT_ENABLED: 'true', HERMES_RETRIEVAL_ENRICHMENT_STORE: store };
  const enrichmentById = await loadEnrichmentById(env);
  assert.deepEqual(enrichmentById.get('rec-alpha').queries, ['existing']);
  assert.equal(enrichmentById.get('rec-alpha').summary, 'note');
  assert.equal(enrichmentById.has('new-record'), false);
  const learnedById = await loadLearnedQueriesById(env);
  assert.deepEqual(learnedById, new Map([['rec-alpha', ['learned wording']], ['new-record', ['new wording']]]));
  assert.deepEqual(await loadLearnedQueriesById({ ...env, HERMES_RETRIEVAL_ENRICHMENT_ENABLED: 'false' }), learnedById);
  assert.equal(await loadEnrichmentById({ ...env, HERMES_RETRIEVAL_ENRICHMENT_ENABLED: 'false' }), null);
  assert.deepEqual(await loadLearnedQueriesById({ ...env, HERMES_FLYWHEEL_LEARNED_ENABLED: 'false' }), new Map());
  assert.deepEqual(await loadLearnedQueriesById({ ...env, HERMES_FLYWHEEL_LEARNED_PATH: path.join(dir, 'missing') }), new Map());
  const answering = createRetrievalAnswering({ records, catalog, valueIndex, lexicalCorpus, evaluate: learnedEvaluate, enrichmentById, learnedById });
  assert.equal((await answering.answer(row.query, null, { stageDump: true })).candidateIds[0], 'rec-alpha');
});

function learnedEvaluate(input) {
  if (input.questions.candidate_0) return { answers: Object.fromEntries(Object.keys(input.questions).map((key) => [key, { type: 'noul', noul: 0.95 }])) };
  const answers = plannerAnswers({ content: true, term: null, sort: 'relevance', limit: 'unspecified', questions: input.questions }).answers;
  answers.scope = { type: 'choice', choice: 'nonconformity' };
  for (const key of Object.keys(input.questions)) if (key.startsWith('field_')) answers[key] = { type: 'choice', choice: 'none' };
  return { answers };
}

test('learned queries rank first lexically while full enrichment reaches semantic search only', async () => {
  const question = '学習専用語';
  const learnedById = new Map([['rec-gamma', [question]]]);
  const enrichmentById = new Map([
    ['rec-gamma', { summary: 'summary', queries: ['existing'], facets: { phenomenon: [{ value: 'tag' }] } }],
    ['rec-beta', { summary: question.repeat(20), queries: [question], facets: { phenomenon: [{ value: question }] } }],
  ]);
  const snapshot = structuredClone({ records, enrichmentById, learnedById, lexicalCorpus });
  const plain = await createRetrievalAnswering({ records, catalog, valueIndex, lexicalCorpus, evaluate: learnedEvaluate, learnedById })
    .answer(question, null, { stageDump: true });
  assert.equal(plain.candidateIds.length, 4);
  assert.equal(plain.candidateIds[0], 'rec-gamma');
  let semanticRecords;
  const answering = createRetrievalAnswering({ records, catalog, valueIndex, lexicalCorpus, evaluate: learnedEvaluate, enrichmentById, learnedById,
    vector: async (_, rows) => { semanticRecords = rows; return { ok: false, status: 'unavailable' }; },
  });
  const result = await answering.answer(question, null, { stageDump: true });
  assert.deepEqual(result.candidateIds, plain.candidateIds);
  assert.deepEqual(semanticRecords.find((record) => record.id === 'rec-gamma').enrichment, { summary: 'summary', queries: ['existing', question], tags: ['tag'] });
  assert.deepEqual({ records, enrichmentById, learnedById, lexicalCorpus }, snapshot);
});

test('absent or empty learned queries preserve answers and lexical candidate order with enrichment', async () => {
  const enrichmentById = new Map([['rec-beta', { summary: 'surface scratch'.repeat(20), queries: ['surface scratch'] }]]);
  const options = { records, catalog, valueIndex, lexicalCorpus, evaluate: learnedEvaluate };
  const baseline = await createRetrievalAnswering(options).answer('surface scratch', null, { stageDump: true });
  for (const learnedById of [null, new Map()]) {
    const result = await createRetrievalAnswering({ ...options, enrichmentById, learnedById }).answer('surface scratch', null, { stageDump: true });
    assert.deepEqual(result.candidateIds, baseline.candidateIds);
    assert.deepEqual(result.recordIds, baseline.recordIds);
    assert.equal(result.answer, baseline.answer);
    assert.deepEqual(result.session, baseline.session);
    assert.equal(result.receipt.outcome, baseline.receipt.outcome);
  }
});

test('corpus refresh reloads learned queries and schedules enriched semantic records', async (t) => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { LEARNED_SCHEMA, learnedPath, writeLearned } = await import('./flywheel-learn.mjs');
  const file = learnedPath(await mkdtemp(path.join(tmpdir(), 'worker-learned-refresh-')));
  const keys = ['HERMES_FLYWHEEL_LEARNED_PATH', 'HERMES_FLYWHEEL_LEARNED_ENABLED', 'HERMES_RETRIEVAL_ENRICHMENT_ENABLED'];
  const saved = keys.map((key) => process.env[key]);
  t.after(() => keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }));
  process.env.HERMES_FLYWHEEL_LEARNED_PATH = file;
  process.env.HERMES_FLYWHEEL_LEARNED_ENABLED = 'true';
  process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED = 'false';
  const query = '学習専用語';
  await writeLearned(file, [{ schema: LEARNED_SCHEMA, recordId: 'nonconformity:rec-gamma', query, state: 'active', source: 'synthetic', from: 'rec-gamma', night: '2026-10-03', at: '2026-10-03T15:00:00Z' }]);
  let scheduled;
  const answering = createRetrievalAnswering({ records, catalog, valueIndex, lexicalCorpus, evaluate: learnedEvaluate,
    learnedById: new Map([['rec-alpha', [query]]]), dense: { schedule: (rows) => { scheduled = rows; } },
  });
  const refreshed = await answering.replaceCorpus({ mode: 'full', records });
  assert.equal(refreshed.ok, true);
  assert.equal((await answering.answer(query, null, { stageDump: true })).candidateIds[0], 'rec-gamma');
  assert.deepEqual(scheduled.find((record) => record.id === 'rec-gamma').enrichment.queries, [query]);
  assert.equal(scheduled.find((record) => record.id === 'rec-alpha').enrichment, undefined);
});

test('answer returns the judged candidate ids only when stageDump is requested', async () => {
  const evaluate = async (input) => {
    if (input.questions.candidate_0) {
      const answers = {};
      for (const [key, question] of Object.entries(input.questions)) {
        const body = String(question.instructions).split('記録本文:\n')[1] ?? '';
        answers[key] = { type: 'noul', noul: body.includes('surface scratch') ? 0.9 : 0.1 };
      }
      return { answers };
    }
    const answers = plannerAnswers({ content: true, limit: 'unspecified', questions: input.questions }).answers;
    answers.scope = { type: 'choice', choice: 'nonconformity' };
    for (const key of Object.keys(input.questions)) if (key.startsWith('field_')) answers[key] = { type: 'choice', choice: 'none' };
    return { answers };
  };
  const answering = answeringWith(evaluate);
  const plain = await answering.answer('surface scratchの記録', null);
  assert.equal('candidateIds' in plain, false);
  const dumped = await answering.answer('surface scratchの記録', null, { stageDump: true });
  assert.equal(dumped.receipt.outcome, 'answer');
  assert.ok(Array.isArray(dumped.candidateIds) && dumped.candidateIds.length >= 1);
  assert.ok(dumped.recordIds.every((id) => dumped.candidateIds.includes(id.slice(id.indexOf(':') + 1))));
});

test('worker forwards page context, records its use, and does not carry its filter to unrelated turns', async () => {
  const pageContext = { path: '/kiosk/part-measurement/self-inspection', entity: { kind: 'partNumber', value: 'N' } };
  const states = [];
  const answering = createRetrievalAnswering({ records: mixedRecords, catalog: mixedCatalog, evaluate: async (input) => {
    states.push(input.state);
    const result = await mixedEvaluate(input);
    result.answers.scope = { type: 'choice', choice: 'nonconformity' };
    result.answers.content = { type: 'noul', noul: false };
    return result;
  } });
  const first = await completeRequest(answering, { type: 'request', requestId: 'page-1', question: 'この品番の不適合', pageContext });
  assert.deepEqual(first.result.recordIds, ['nonconformity:shared']);
  assert.deepEqual(first.result.receipt.plan.filters, [{ source: 'nonconformity', field: 'partNumber', op: 'eq', values: ['N'] }]);
  assert.deepEqual(first.result.receipt.pageContext, { used: true, ...pageContext.entity });
  const next = await answering.answer('最近の不適合', first.result.session, { stageDump: true, pageContext });
  assert.deepEqual(next.receipt.pageContext, { used: false, ...pageContext.entity });
  assert.equal(states.at(-1).page_context, undefined);
  assert.deepEqual(states.at(-1).previous_plan.filters, []);
  assert.deepEqual(next.receipt.plan.filters, []);
  assert.deepEqual(next.candidateIds, ['shared']);
  const plain = await answering.answer('最近の不適合');
  assert.equal('pageContext' in plain.receipt, false);
});

test('completeRequest keeps the omitted third argument and forwards context in the options object', async () => {
  const calls = [];
  const answering = { answer: async (...args) => { calls.push(args); return { elapsedMs: 1 }; } };
  const pageContext = { path: '/page', entity: { kind: 'partNumber', value: 'P' } };
  await completeRequest(answering, { type: 'request', requestId: 'a', question: 'q' });
  await completeRequest(answering, { type: 'request', requestId: 'b', question: 'q', pageContext });
  const principal = { kind: 'viewer' };
  await completeRequest(answering, { type: 'request', requestId: 'c', question: 'q', principal });
  await completeRequest(answering, { type: 'request', requestId: 'd', question: 'q', pageContext, principal });
  assert.deepEqual(calls, [['q', null], ['q', null, { pageContext }], ['q', null, { principal }], ['q', null, { pageContext, principal }]]);
});

test('answer takes a vector budget for night scoring; the day budget still applies by default', async () => {
  const evaluate = async (input) => {
    if (input.questions.candidate_0) {
      const answers = {};
      for (const [key, question] of Object.entries(input.questions)) {
        const body = String(question.instructions).split('記録本文:\n')[1] ?? '';
        answers[key] = { type: 'noul', noul: body.includes('surface scratch') ? 0.9 : 0.1 };
      }
      return { answers };
    }
    const answers = plannerAnswers({ content: true, limit: 'unspecified', questions: input.questions }).answers;
    answers.scope = { type: 'choice', choice: 'nonconformity' };
    for (const key of Object.keys(input.questions)) if (key.startsWith('field_')) answers[key] = { type: 'choice', choice: 'none' };
    return { answers };
  };
  const slowVector = (delayMs) => async (query, filtered) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const ids = filtered.map((record) => record.id);
    return { ok: true, status: 'ok', orderedIds: ids, cosines: new Map(ids.map((id) => [id, 0.8])) };
  };
  const answering = createRetrievalAnswering({ records, catalog, valueIndex, lexicalCorpus, evaluate, vector: slowVector(1700), snapshotCount: records.length });
  const day = await answering.answer('surface scratchの記録', null, { stageDump: true });
  assert.equal(day.receipt.timings.vectorStatus, 'timeout');
  const night = await answering.answer('surface scratchの記録', null, { stageDump: true, vectorBudgetMs: 5000 });
  assert.equal(night.receipt.timings.vectorStatus, 'ok');
});
