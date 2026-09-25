// JSON-lines worker for the lexical + one planner call + one relevance call path.
// Vector ranking stays off unless HERMES_RETRIEVAL_VECTOR_ENABLED=true.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { catalogEntries, fieldsWithRole, loadNonconformityCatalog } from './catalog.mjs';
import { createDenseRuntime, denseSettings } from './dense-dgx.mjs';
import { execute, openQmdVectorRanker, prepareLexicalCorpus } from './executor.mjs';
import { createPlanner } from './planner-jev.mjs';
import { createRelevanceJudge } from './relevance-jev.mjs';
import { validateQueryPlan } from './query-plan.mjs';
import { buildValueIndex, findCandidateValues } from './value-index.mjs';
import { buildCorpusView, replaceCorpus, stampAnswer } from './corpus.mjs';
import { attachEnrichment } from './enrichment-attach.mjs';
import { readEnrichmentStore, storePathFromEnv } from './enrichment-store.mjs';

export const WORKER_PREFIX = '__HERMES_UI_PREFETCH__';
let denseFallbackCount = 0;

export function noteDenseFallback(status) {
  denseFallbackCount += 1;
  console.info(`hermes retrieval dense fallback count=${denseFallbackCount} status=${status}`);
}
const ANSWER_ROLES = new Set(['identifier', 'date', 'organization', 'body']);
const INSUFFICIENT_NOTICE = '見つかった件数は、指定された件数より少ないです。';
const COVERAGE_ORDER = {
  date_desc: '新しい順',
  date_asc: '古い順',
  relevance: '関連度の高い順',
};
const OUT_OF_SCOPE_ANSWER = '不適合情報の検索に関する質問として解釈できませんでした。';
const UNAVAILABLE_ANSWER = '検索に失敗しました。該当なしとは判断していません。';
const TYPESAFE_FAILURE_CODES = new Set([
  'missing_credentials', 'transport_unavailable', 'upstream_http', 'invalid_json',
  'invalid_answers', 'timeout', 'connection_failed',
]);
const SAFE_EXCEPTION_NAMES = new Set([
  'AbortError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'Error',
]);

export function formatCoverageNotice(coverage) {
  if (!coverage || !Number.isInteger(coverage.shown) || coverage.shown < 1) return '';
  const order = COVERAGE_ORDER[coverage.order] ?? COVERAGE_ORDER.date_desc;
  if (coverage.known === true && Number.isInteger(coverage.total) && coverage.total > coverage.shown) {
    return `該当${coverage.total}件のうち、${order}に${coverage.shown}件を表示しています。`;
  }
  if (coverage.known === false && Number.isInteger(coverage.floor) && coverage.floor > coverage.shown) {
    return `該当${coverage.floor}件以上のうち、${order}に${coverage.shown}件を表示しています。`;
  }
  if (coverage.known === false) return 'ほかにも該当する可能性があります。';
  return '';
}

export function noResultAnswer(snapshotCount) {
  const count = Number.isInteger(snapshotCount) && snapshotCount >= 0 ? snapshotCount : 0;
  return `検索対象${count}件の中に、一致する記録は見つかりませんでした。これは不存在の証明ではありません。`;
}

export function failureDiagnostic(error) {
  const diagnostic = error?.hermesDiagnostic;
  if (error?.name === 'TypeSafeDirectError'
    && diagnostic?.provider === 'typesafe-direct'
    && TYPESAFE_FAILURE_CODES.has(diagnostic.failureCode)
    && (diagnostic.failureCode !== 'upstream_http'
      || (Number.isInteger(diagnostic.httpStatus) && diagnostic.httpStatus >= 100 && diagnostic.httpStatus <= 599))) {
    return {
      stage: 'jev_query',
      exceptionType: 'TypeSafeDirectError',
      provider: 'typesafe-direct',
      failureCode: diagnostic.failureCode,
      ...(diagnostic.failureCode === 'upstream_http' ? { httpStatus: diagnostic.httpStatus } : {}),
    };
  }
  return {
    stage: 'worker_request',
    exceptionType: SAFE_EXCEPTION_NAMES.has(error?.name) ? error.name : 'Error',
    failureCode: 'unclassified',
  };
}

export function encodeWorkerLine(value) {
  return `${WORKER_PREFIX}${JSON.stringify(value)}\n`;
}

export function snapshotPathFromEnv(env = process.env) {
  const raw = env.HERMES_SEARCH_RECORD_SOURCE || env.HERMES_TRIAL_SNAPSHOT_PATH;
  if (!raw || typeof raw !== 'string') throw new Error('snapshot path is not set');
  return raw;
}

function catalogFields(catalog) {
  return catalogEntries(catalog).flatMap((entry) => entry.fields);
}

export function compactPlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  return {
    sources: Array.isArray(plan.sources) ? [...plan.sources] : [],
    filters: Array.isArray(plan.filters) ? plan.filters.map((filter) => ({
      source: filter.source,
      field: filter.field,
      op: filter.op,
      values: Array.isArray(filter.values) ? [...filter.values] : [],
    })) : [],
    semanticQuery: typeof plan.semanticQuery === 'string' ? plan.semanticQuery : '',
    sort: plan.sort ?? null,
    limit: plan.limit ?? null,
  };
}

function sessionOf(previousPlan) {
  return {
    pending: null,
    searchRequest: null,
    searchState: null,
    jevDialogue: [],
    previousPlan,
  };
}

function clarificationAnswer(clarification) {
  const lines = ['次の候補から選んでください。'];
  for (const group of clarification?.candidates ?? []) {
    const values = (group?.candidates ?? []).filter((value) => typeof value === 'string' && value);
    if (values.length) lines.push(values.join('\n'));
  }
  if (lines.length === 1) lines.push('条件を特定できませんでした。');
  return lines.join('\n');
}

function confirmationPending(question, clarification, answer) {
  const requiredItems = (clarification?.candidates ?? []).map((group, index) => ({
    id: `term_${index}`,
    label: typeof group?.term === 'string' && group.term ? group.term : '候補',
    type: 'string',
    candidates: (group?.candidates ?? []).filter((value) => typeof value === 'string'),
  }));
  return {
    request: String(question ?? '').slice(0, 200),
    question: answer,
    purpose: 'collect_missing_values',
    requiredItems,
    confirmedInfo: {},
    unresolvedItems: requiredItems.map((item) => item.id),
  };
}

function formatRecords(results, catalog) {
  const fields = catalogFields(catalog).filter((field) => ANSWER_ROLES.has(field.role));
  return (results ?? []).map((result) => {
    const lines = [];
    for (const field of fields) {
      const value = result?.fields?.[field.key];
      if (typeof value !== 'string') continue;
      lines.push(`${field.label}: ${value}`);
    }
    return lines.join('\n');
  }).filter(Boolean).join('\n\n');
}

function applyEnrichment(view, enrichmentById) {
  if (!enrichmentById || enrichmentById.size === 0) return view;
  return { ...view, records: attachEnrichment(view.records, enrichmentById) };
}

async function loadEnrichmentById() {
  try {
    return await readEnrichmentStore(storePathFromEnv());
  } catch {
    console.warn('hermes retrieval enrichment store unreadable');
    return null;
  }
}

function publicRecordId(sourceId, recordId) {
  const id = String(recordId ?? '');
  if (!id) return id;
  if (id.includes(':')) return id;
  return sourceId ? `${sourceId}:${id}` : id;
}

function trialResult({ status, answer, recordIds, elapsedMs, confirmation, previousPlan, dataAsOf, coverage = null }) {
  const stamped = stampAnswer(answer, dataAsOf);
  return {
    status,
    answer: stamped.answer,
    recordIds,
    elapsedMs,
    dataAsOf: stamped.dataAsOf,
    confirmationPending: confirmation ?? null,
    session: sessionOf(previousPlan),
    ...(coverage ? { coverage } : {}),
  };
}

export function createRetrievalAnswering({
  records,
  catalog,
  valueIndex,
  lexicalCorpus = null,
  evaluate,
  vector = null,
  dense = null,
  enrichmentById = null,
  snapshotCount = Array.isArray(records) ? records.length : 0,
} = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  const planner = createPlanner(typeof evaluate === 'function' ? { evaluate } : {});
  const relevance = createRelevanceJudge(typeof evaluate === 'function' ? { evaluate } : {});
  const sourceId = catalogEntries(catalog)[0]?.id ?? null;
  let current = applyEnrichment(buildCorpusView(records, catalog, null), enrichmentById);
  if (valueIndex) current = { ...current, valueIndex, lexicalCorpus, snapshotCount };
  return {
    async replaceCorpus(message) {
      const count = current.snapshotCount;
      try {
        const enrichmentById = await readEnrichmentStore(storePathFromEnv()).catch(() => null);
        current = applyEnrichment(replaceCorpus(current, catalog, message), enrichmentById);
        dense?.schedule?.(current.records, fieldsWithRole(catalog, 'body'));
        return { ok: true, count: current.snapshotCount };
      } catch {
        console.warn(`hermes retrieval corpus refresh failed count=${count}`);
        return { ok: false, count };
      }
    },
    async answer(question, session) {
      const view = current;
      const started = performance.now();
      const elapsed = () => Math.round((performance.now() - started) * 10) / 10;
      const previousPlan = session?.previousPlan && typeof session.previousPlan === 'object' ? session.previousPlan : null;
      const candidates = findCandidateValues(question, view.valueIndex, catalog);
      const planned = await planner.plan({
        question,
        previousPlan,
        catalog,
        candidates,
        valueIndex: view.valueIndex,
      });
      const compact = compactPlan(planned.plan);
      if (planned.plan?.diagnostics?.scope === 'out_of_scope') {
        return trialResult({
          status: 'completed',
          answer: OUT_OF_SCOPE_ANSWER,
          recordIds: [],
          elapsedMs: elapsed(),
          previousPlan: compact,
          dataAsOf: view.dataAsOf,
        });
      }
      const validation = validateQueryPlan(planned.plan, catalog, view.valueIndex);
      if (!validation.ok) {
        const answer = clarificationAnswer(validation.clarification);
        return trialResult({
          status: 'clarification',
          answer,
          recordIds: [],
          elapsedMs: elapsed(),
          confirmation: confirmationPending(question, validation.clarification, answer),
          previousPlan: compact,
          dataAsOf: view.dataAsOf,
        });
      }
      const executed = await execute(validation.plan, {
        records: view.records,
        catalog,
        lexicalCorpus: view.lexicalCorpus,
        retriever: dense?.queryEnabled ? 'hybrid' : 'lexical',
        vector: dense?.queryEnabled ? (query, filtered) => dense.rank(query, filtered) : (typeof vector === 'function' ? vector : null),
        relevance: (input) => relevance.judge(input),
        requestStartedAt: started,
      });
      if (executed.status === 'unavailable') {
        return trialResult({
          status: 'unavailable',
          answer: UNAVAILABLE_ANSWER,
          recordIds: [],
          elapsedMs: elapsed(),
          previousPlan: compact,
          dataAsOf: view.dataAsOf,
        });
      }
      if (executed.status === 'no_result') {
        return trialResult({
          status: 'completed',
          answer: noResultAnswer(view.snapshotCount),
          recordIds: [],
          elapsedMs: elapsed(),
          previousPlan: compact,
          dataAsOf: view.dataAsOf,
        });
      }
      const vectorStatus = executed.timings?.vectorStatus;
      if (dense?.queryEnabled && (vectorStatus === 'timeout' || vectorStatus === 'failed')) {
        noteDenseFallback(vectorStatus);
      }
      const body = formatRecords(executed.results, catalog);
      const notice = formatCoverageNotice(executed.coverage);
      let answer = executed.insufficient && body ? `${body}\n\n${INSUFFICIENT_NOTICE}` : body;
      if (notice) answer = answer ? `${answer}\n\n${notice}` : notice;
      return trialResult({
        status: 'completed',
        answer,
        recordIds: executed.results.map((result) => publicRecordId(result.sourceId ?? sourceId, result.recordId)),
        elapsedMs: elapsed(),
        previousPlan: compact,
        dataAsOf: view.dataAsOf,
        coverage: executed.coverage ?? null,
      });
    },
  };
}

export async function loadRetrievalResources(env = process.env) {
  const payload = JSON.parse(await readFile(snapshotPathFromEnv(env), 'utf8'));
  if (!Array.isArray(payload?.records)) throw new Error('snapshot records must be an array');
  const catalog = loadNonconformityCatalog();
  const records = payload.records;
  const valueIndex = buildValueIndex(records, catalog);
  const lexicalCorpus = prepareLexicalCorpus(records, fieldsWithRole(catalog, 'body'));
  const snapshotId = typeof payload.snapshotId === 'string' && payload.snapshotId
    ? payload.snapshotId
    : typeof payload.id === 'string' && payload.id
      ? payload.id
      : `records:${records.length}`;
  return {
    records,
    catalog,
    valueIndex,
    lexicalCorpus,
    snapshotCount: records.length,
    snapshotId,
  };
}

export function readyPayload(resources) {
  return {
    workerReady: true,
    runtime: {
      protocol: 'hermes-retrieval/v2',
      snapshot: {
        count: resources.snapshotCount,
        snapshotId: resources.snapshotId,
      },
    },
  };
}

async function openOptionalVector(env, sourceId) {
  if (env.HERMES_RETRIEVAL_VECTOR_ENABLED !== 'true') return null;
  if (!env.HERMES_QMD_INDEX || !env.HERMES_QMD_EMBED_MODEL_PATH || !env.HERMES_QMD_ROOT) return null;
  const workRoot = env.HERMES_RETRIEVAL_WORK_ROOT
    ?? path.join(env.HOME ?? '/tmp', 'Documents', 'hermes-retrieval-private', 'work');
  const ranker = await openQmdVectorRanker({
    indexSourcePath: env.HERMES_QMD_INDEX,
    embedModelPath: env.HERMES_QMD_EMBED_MODEL_PATH,
    workRoot,
    qmdRoot: env.HERMES_QMD_ROOT,
    sourceId,
  });
  return ranker;
}

export async function completeRequest(answering, request) {
  const requestId = request && typeof request.requestId === 'string' ? request.requestId : null;
  try {
    if (!request || request.type !== 'request' || !requestId || typeof request.question !== 'string') {
      throw new Error('request type, requestId, and question are required');
    }
    const result = await answering.answer(request.question, request.session ?? null);
    return { workerRequestId: requestId, stage: 'completed', result, elapsedMs: result.elapsedMs };
  } catch (error) {
    return {
      workerRequestId: requestId,
      workerError: 'trial worker request failed',
      failureDiagnostic: failureDiagnostic(error),
    };
  }
}

let emitQueue = Promise.resolve();

function emit(value) {
  const line = encodeWorkerLine(value);
  emitQueue = emitQueue.then(() => new Promise((resolve, reject) => {
    process.stdout.write(line, (error) => (error ? reject(error) : resolve()));
  }));
  return emitQueue;
}

export function dispatchWorkerRequest(answering, request, emitFn = emit) {
  return completeRequest(answering, request).then((payload) => {
    emitFn(payload);
    return payload;
  });
}

export async function main() {
  let ranker = null;
  let answering;
  try {
    let resources;
    try {
      resources = await loadRetrievalResources();
    } catch {
      const catalog = loadNonconformityCatalog();
      const view = buildCorpusView([], catalog, null);
      resources = { ...view, catalog, snapshotId: 'pending-refresh' };
    }
    try {
      ranker = await openOptionalVector(process.env, resources.catalog?.id ?? null);
    } catch {
      ranker = null;
    }
    const denseConfig = denseSettings(process.env);
    const dense = (denseConfig.queryEnabled || denseConfig.indexEnabled)
      ? createDenseRuntime({ settings: denseConfig })
      : null;
    if (dense) {
      await dense.load().catch(() => 0);
      dense.schedule(resources.records, fieldsWithRole(resources.catalog, 'body'));
    }
    answering = createRetrievalAnswering({
      ...resources,
      enrichmentById: await loadEnrichmentById(),
      dense,
      vector: ranker ? (query, filtered) => ranker.rank(query, filtered) : null,
    });
    emit(readyPayload(resources));
  } catch (error) {
    emit({ workerError: 'trial worker startup failed', detail: String(error?.name ?? 'Error') });
    process.exitCode = 1;
    return;
  }
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = [];
  for await (const line of input) {
    if (!line.trim()) continue;
    let request = null;
    try {
      request = JSON.parse(line);
    } catch (error) {
      pending.push(Promise.resolve(emit({
        workerRequestId: null,
        workerError: 'trial worker request failed',
        failureDiagnostic: failureDiagnostic(error),
      })));
      continue;
    }
    if (request?.type === 'cancel') continue;
    if (request?.type === 'corpus') {
      pending.push(Promise.resolve(answering.replaceCorpus(request)));
      continue;
    }
    pending.push(dispatchWorkerRequest(answering, request));
  }
  await Promise.allSettled(pending);
  await emitQueue;
  if (ranker) await ranker.close();
}

if (process.argv.includes('--hermes-ui-prefetch-worker') || process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    emit({ workerError: 'trial worker fatal error', detail: String(error?.name ?? 'Error') });
    process.exitCode = 1;
  });
}
