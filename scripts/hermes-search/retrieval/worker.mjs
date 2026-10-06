// JSON-lines worker for the lexical + one planner call + one relevance call path.
// Vector ranking stays off unless HERMES_RETRIEVAL_VECTOR_ENABLED=true.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { catalogEntries, definitionForCatalog, fieldsWithRole, loadCatalog } from './catalog.mjs';
import { recordSourceId, sourceIdsFromEnv } from '../hermes-source-definition.mjs';
import { createDenseRuntime, denseSettings } from './dense-dgx.mjs';
import { execute, openQmdVectorRanker, prepareLexicalCorpus } from './executor.mjs';
import { createPlanner } from './planner-jev.mjs';
import { createRelevanceJudge } from './relevance-jev.mjs';
import { validateQueryPlan } from './query-plan.mjs';
import { buildValueIndex, findCandidateValues } from './value-index.mjs';
import { authorizedRecords, buildCorpusView, replaceCorpus, stampAnswer } from './corpus.mjs';
import { attachEnrichment } from './enrichment-attach.mjs';
import { readEnrichmentStore, storePathFromEnv } from './enrichment-store.mjs';
import { learnedPathFromEnv, learnedQueriesById, mergeLearnedQueries, readLearned } from './flywheel-learn.mjs';
import { bareId } from './flywheel-pairs.mjs';

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
  source_order: 'ソース順',
};
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

function memoryReport(records, catalog) {
  const usage = process.memoryUsage();
  const mb = (bytes) => Math.round(bytes / (1024 * 1024) * 10) / 10;
  const bySource = Object.fromEntries(catalogEntries(catalog).map((entry) => [entry.id, 0]));
  for (const record of records) {
    const sourceId = recordSourceId(record);
    bySource[sourceId] = (bySource[sourceId] ?? 0) + 1;
  }
  return {
    heapUsedMb: mb(usage.heapUsed),
    rssMb: mb(usage.rss),
    externalMb: mb(usage.external),
    arrayBuffersMb: mb(usage.arrayBuffers),
    records: records.length,
    bySource,
  };
}

export function snapshotPathFromEnv(env = process.env) {
  const raw = env.HERMES_SEARCH_RECORD_SOURCE || env.HERMES_TRIAL_SNAPSHOT_PATH;
  if (!raw || typeof raw !== 'string') throw new Error('snapshot path is not set');
  return raw;
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
    // The content part the judge read, so a follow-up that reuses the content judges the same text.
    ...(typeof plan.diagnostics?.contentSpan === 'string' && plan.diagnostics.contentSpan
      ? { contentSpan: plan.diagnostics.contentSpan }
      : {}),
    sort: plan.sort ?? null,
    limit: plan.limit ?? null,
  };
}

// Records shown in this conversation, newest last, as public ids (source:id). Kept so a later
// request for other records can hide them.
export const SHOWN_IDS_CAP = 200;

function sessionOf(previousPlan, shownIds = []) {
  return {
    pending: null,
    searchRequest: null,
    searchState: null,
    jevDialogue: [],
    previousPlan,
    shownIds,
  };
}

function shownIdsOf(session) {
  return Array.isArray(session?.shownIds) ? session.shownIds.filter((id) => typeof id === 'string' && id) : [];
}

function withShown(previous, added) {
  const merged = [...previous.filter((id) => !added.includes(id)), ...added];
  return merged.slice(-SHOWN_IDS_CAP);
}

export function noOtherAnswer(shownCount) {
  return `さきほど示した${shownCount}件のほかに、条件に合う記録は見つかりませんでした。`;
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
  const entries = catalogEntries(catalog);
  return (results ?? []).map((result) => {
    const entry = entries.find((entry) => entry.id === result.sourceId);
    if (!entry) return '';
    const fields = entry.fields.filter((field) => ANSWER_ROLES.has(field.role));
    const lines = entries.length > 1 ? [`【${entry.label}】`] : [];
    for (const field of fields) {
      const value = result?.fields?.[field.key];
      if (typeof value !== 'string') continue;
      lines.push(`${field.label}: ${value}`);
    }
    return lines.join('\n');
  }).filter(Boolean).join('\n\n');
}

function applyEnrichment(view, enrichmentById, catalog, learnedById) {
  let current = view;
  for (const entry of catalogEntries(catalog)) {
    const capabilities = definitionForCatalog(entry).retrieval ?? {};
    const enrichment = capabilities.enrichment ? enrichmentById : null;
    const learned = capabilities.learnedQueries ? learnedById : null;
    const hasLearned = learned?.size > 0;
    if ((!enrichment || enrichment.size === 0) && !hasLearned) continue;
    const source = current.bySource[entry.id];
    if (!source) continue;
    const merged = hasLearned ? mergeLearnedQueries(enrichment,
      [...learned].flatMap(([recordId, queries]) => queries.map((query) => ({ recordId, query }))), { states: null }) : enrichment;
    const records = attachEnrichment(source.records, merged);
    // Keep summaries and tags out of lexical ranking; only learned queries extend the body.
    const lexicalCorpus = hasLearned ? prepareLexicalCorpus(records.map((record) => ({
      ...record,
      enrichment: { queries: learned.get(bareId(record.id)) ?? [], tags: [], summary: '' },
    })), fieldsWithRole(entry, 'body')) : source.lexicalCorpus;
    const enriched = new Map(records.map((record) => [record.id, record]));
    current = {
      ...current,
      records: current.records.map((record) => recordSourceId(record) === entry.id ? enriched.get(record.id) : record),
      bySource: { ...current.bySource, [entry.id]: { ...source, records, lexicalCorpus } },
      ...(hasLearned && catalogEntries(catalog).length === 1 ? { lexicalCorpus } : {}),
    };
  }
  return current;
}

function combineExecutions(executions) {
  if (executions.length === 1) return executions[0];
  const unavailable = executions.find((execution) => execution.status === 'unavailable');
  if (unavailable) return unavailable;
  const results = executions.flatMap((execution) => execution.results);
  const coverages = executions.map((execution) => execution.coverage ?? { known: true, total: execution.results.length });
  const known = coverages.every((coverage) => coverage?.known === true);
  const timings = {};
  for (const execution of executions) {
    for (const [key, value] of Object.entries(execution.timings ?? {})) {
      if (typeof value === 'number') timings[key] = (timings[key] ?? 0) + value;
      else if (!(key in timings) || key === 'vectorStatus' && ['failed', 'timeout', 'ok'].includes(value)) timings[key] = value;
    }
  }
  return {
    status: results.length ? 'answer' : 'no_result',
    results,
    excludedMatches: executions.reduce((sum, execution) => sum + (execution.excludedMatches ?? 0), 0),
    insufficient: executions.some((execution) => execution.insufficient),
    candidateIds: executions.flatMap((execution) => execution.candidateIds ?? []),
    coverage: {
      known,
      total: known ? coverages.reduce((sum, coverage) => sum + coverage.total, 0) : null,
      floor: known ? null : coverages.reduce((sum, coverage) => sum + (coverage?.total ?? coverage?.floor ?? 0), 0),
      shown: results.length,
      order: 'source_order',
    },
    timings,
  };
}

function selectedSourcePlan(plan, entries) {
  if (!plan || !Array.isArray(plan.sources)) return plan;
  const selected = entries.filter((entry) => plan.sources.includes(entry.id));
  const hasField = (list, key) => list.some((entry) => entry.fields.some((field) => field.key === key));
  // The existing planner emits the whole catalog's display keys and its first date field.
  const display = Array.isArray(plan.display)
    ? plan.display.filter((key) => hasField(selected, key) || !hasField(entries, key)) : plan.display;
  const sort = plan.sort;
  const date = selected.flatMap((entry) => entry.fields).find((field) => field.role === 'date');
  const catalogDate = entries.some((entry) => entry.fields.some((field) => field.key === sort?.field && field.role === 'date'));
  return {
    ...plan,
    display,
    sort: sort && sort !== 'relevance' && !hasField(selected, sort.field) && catalogDate && date
      ? { ...sort, field: date.key } : sort,
  };
}

// The stored enrichment is attached only while HERMES_RETRIEVAL_ENRICHMENT_ENABLED is true, the
// same flag that runs the overnight enrichment. Full-corpus enrichment showed only a small gain
// (2026-10-02), so turning the flag off stops both; the store stays on disk.
export function enrichmentAttachEnabled(env = process.env) {
  return env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED === 'true';
}

export async function loadEnrichmentById(env = process.env) {
  let enrichmentById = null;
  if (enrichmentAttachEnabled(env)) {
    try {
      enrichmentById = await readEnrichmentStore(storePathFromEnv(env));
    } catch {
      console.warn('hermes retrieval enrichment store unreadable');
    }
  }
  return enrichmentById;
}

export async function loadLearnedQueriesById(env = process.env) {
  if (env.HERMES_FLYWHEEL_LEARNED_ENABLED === 'false') return new Map();
  return learnedQueriesById(await readLearned(learnedPathFromEnv(env)));
}

function publicRecordId(sourceId, recordId) {
  const id = String(recordId ?? '');
  if (!id) return id;
  if (id.includes(':')) return id;
  return sourceId ? `${sourceId}:${id}` : id;
}

function trialResult({ status, answer, recordIds, elapsedMs, confirmation, previousPlan, dataAsOf, coverage = null, receipt = null, shownIds = [], candidateIds = null }) {
  const stamped = stampAnswer(answer, dataAsOf);
  return {
    status,
    answer: stamped.answer,
    recordIds,
    elapsedMs,
    dataAsOf: stamped.dataAsOf,
    confirmationPending: confirmation ?? null,
    session: sessionOf(previousPlan, shownIds),
    ...(coverage ? { coverage } : {}),
    ...(Array.isArray(candidateIds) ? { candidateIds } : {}),
    ...(receipt ? { receipt: { ...receipt, elapsedMs } } : {}),
  };
}

function numericTimings(timings) {
  const picked = {};
  for (const [key, value] of Object.entries(timings ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) picked[key] = Math.round(value * 10) / 10;
    else if (typeof value === 'string' && value.length <= 32) picked[key] = value;
  }
  return picked;
}

export function createRetrievalAnswering({
  records,
  catalog,
  valueIndex,
  lexicalCorpus = null,
  evaluate,
  planner: suppliedPlanner = null,
  vector = null,
  dense = null,
  denseBySource = null,
  vectorBySource = null,
  enrichmentById = null,
  learnedById = null,
  snapshotCount = Array.isArray(records) ? records.length : 0,
} = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  const planner = suppliedPlanner ?? createPlanner(typeof evaluate === 'function' ? { evaluate } : {});
  const relevance = createRelevanceJudge(typeof evaluate === 'function' ? { evaluate } : {});
  const entries = catalogEntries(catalog);
  const semanticEntries = entries.filter((entry) => definitionForCatalog(entry).retrieval?.semanticSearch);
  const denseFor = (sourceId) => denseBySource?.[sourceId] ?? dense;
  const vectorFor = (sourceId) => vectorBySource?.[sourceId] ?? vector;
  let current = buildCorpusView(records, catalog, null);
  if (valueIndex) {
    current = { ...current, valueIndex, lexicalCorpus, snapshotCount };
    if (entries.length === 1 && lexicalCorpus) current.bySource[entries[0].id].lexicalCorpus = lexicalCorpus;
  }
  current = applyEnrichment(current, enrichmentById, catalog, learnedById);
  return {
    async replaceCorpus(message) {
      const count = current.snapshotCount;
      try {
        current = applyEnrichment(replaceCorpus(current, catalog, message), await loadEnrichmentById(), catalog, await loadLearnedQueriesById());
        for (const entry of semanticEntries) denseFor(entry.id)?.schedule?.(current.bySource[entry.id].records, fieldsWithRole(entry, 'body'));
        return { ok: true, count: current.snapshotCount, memory: memoryReport(current.records, catalog) };
      } catch {
        console.warn(`hermes retrieval corpus refresh failed count=${count}`);
        return { ok: false, count, memory: memoryReport(current.records, catalog) };
      }
    },
    // `options.stageDump` adds the ranked candidate ids to the result, and `options.vectorBudgetMs`
    // replaces the day's embedding budget; the kiosk never passes either.
    async answer(question, session, options = {}) {
      const view = current;
      const visibleEntries = options.principal
        ? entries.filter((entry) => entry.visibility.includes(options.principal.kind)) : entries;
      const visibleSources = new Set(visibleEntries.map((entry) => entry.id));
      const visibleCatalog = options.principal ? visibleEntries : catalog;
      const visibleValueIndex = options.principal
        ? { values: Object.fromEntries(visibleEntries.map((entry) => [entry.id, view.valueIndex.values[entry.id]])) }
        : view.valueIndex;
      const visibleCount = options.principal
        ? visibleEntries.reduce((count, entry) => count + view.bySource[entry.id].records.length, 0) : view.snapshotCount;
      const outOfScopeAnswer = visibleEntries.length === 1 && definitionForCatalog(visibleEntries[0]).outOfScopeAnswer ? definitionForCatalog(visibleEntries[0]).outOfScopeAnswer
        : `${visibleEntries.length ? `${visibleEntries.map((entry) => entry.label).join('・')}の` : ''}検索に関する質問として解釈できませんでした。`;
      const stageDump = options.stageDump === true;
      const vectorBudgetMs = Number.isFinite(options.vectorBudgetMs) && options.vectorBudgetMs > 0 ? options.vectorBudgetMs : undefined;
      const started = performance.now();
      const elapsed = () => Math.round((performance.now() - started) * 10) / 10;
      const storedPlan = session?.previousPlan && typeof session.previousPlan === 'object' ? session.previousPlan : null;
      // A session carried from a wider role must not expose its source values to the planner.
      const previousPlan = options.principal && storedPlan
        && (storedPlan.sources?.some((source) => !visibleSources.has(source))
          || storedPlan.filters?.some((filter) => !visibleSources.has(filter.source))) ? null : storedPlan;
      const previouslyShown = options.principal
        ? shownIdsOf(session).filter((id) => visibleEntries.some((entry) => id.startsWith(`${entry.id}:`))) : shownIdsOf(session);
      if (!visibleEntries.length) {
        return trialResult({ status: 'completed', answer: outOfScopeAnswer, recordIds: [], elapsedMs: elapsed(),
          previousPlan: null, shownIds: [], dataAsOf: view.dataAsOf });
      }
      const candidates = findCandidateValues(question, visibleValueIndex, visibleCatalog);
      const planned = await planner.plan({
        question,
        previousPlan,
        catalog: visibleCatalog,
        candidates,
        valueIndex: visibleValueIndex,
        shownCount: previouslyShown.length,
        ...(options.pageContext ? { pageContext: options.pageContext } : {}),
      });
      // Reject an unauthorized source even if a supplied planner attempts to select it.
      if (options.principal && (planned.plan?.sources?.some((source) => !visibleSources.has(source))
        || planned.plan?.filters?.some((filter) => !visibleSources.has(filter.source)))) {
        return trialResult({ status: 'completed', answer: outOfScopeAnswer, recordIds: [], elapsedMs: elapsed(),
          previousPlan: null, shownIds: previouslyShown, dataAsOf: view.dataAsOf });
      }
      const searchPlan = selectedSourcePlan(planned.plan, visibleEntries);
      const compact = compactPlan(searchPlan);
      // A screen-derived condition belongs to this turn only. Do not carry its
      // value into the next question through previous_plan when no pointer is used.
      const entity = options.pageContext?.entity;
      const sessionPlan = planned.receipt?.pageContext?.used && entity && compact
        ? { ...compact, filters: compact.filters.filter((filter) => {
          const entry = visibleEntries.find((entry) => entry.id === filter.source);
          const attributes = entry && definitionForCatalog(entry).pageContextAttributes;
          const field = attributes ? attributes[entity.kind] : entity.kind;
          return !(filter.field === field && filter.values.includes(entity.value));
        }) }
        : compact;
      // One receipt per answer for the API log: the planner decisions and the outcome.
      const receiptOf = (outcome, extra = {}) => ({
        schema: 'hermes-search-receipt/v1',
        outcome,
        plan: compact,
        unresolved: Array.isArray(planned.plan?.unresolved) ? planned.plan.unresolved.map((item) => item?.term ?? null) : [],
        jev: planned.receipt ?? null,
        planMs: planned.timings?.planMs ?? null,
        ...(options.pageContext ? { pageContext: planned.receipt?.pageContext ?? { used: false, ...options.pageContext.entity } } : {}),
        ...extra,
      });
      if (planned.plan?.diagnostics?.scope === 'out_of_scope') {
        return trialResult({
          status: 'completed',
          answer: outOfScopeAnswer,
          recordIds: [],
          elapsedMs: elapsed(),
          previousPlan: sessionPlan,
          shownIds: previouslyShown,
          receipt: receiptOf('out_of_scope'),
          dataAsOf: view.dataAsOf,
        });
      }
      const validation = validateQueryPlan(searchPlan, visibleCatalog, visibleValueIndex);
      if (!validation.ok) {
        const answer = clarificationAnswer(validation.clarification);
        return trialResult({
          status: 'clarification',
          answer,
          recordIds: [],
          elapsedMs: elapsed(),
          confirmation: confirmationPending(question, validation.clarification, answer),
          previousPlan: sessionPlan,
          shownIds: previouslyShown,
          receipt: receiptOf('clarification'),
          dataAsOf: view.dataAsOf,
        });
      }
      const executions = [];
      const usesDense = semanticEntries.some((entry) => validation.plan.sources.includes(entry.id) && denseFor(entry.id)?.queryEnabled);
      for (const sourceId of validation.plan.sources) {
        const entry = visibleEntries.find((entry) => entry.id === sourceId);
        const sourceView = view.bySource[sourceId];
        const semantic = definitionForCatalog(entry).retrieval?.semanticSearch;
        const sourceDense = semantic ? denseFor(sourceId) : null;
        const sourceVector = semantic ? vectorFor(sourceId) : null;
        const plan = validation.plan;
        const dateField = entry.fields.find((field) => field.role === 'date');
        const sort = plan.sort !== 'relevance' && !entry.fields.some((field) => field.key === plan.sort.field)
          ? (dateField ? { ...plan.sort, field: dateField.key } : 'relevance') : plan.sort;
        executions.push(await execute({ ...plan, sources: [sourceId], filters: plan.filters.filter((filter) => filter.source === sourceId), sort }, {
          records: sourceView.records,
          catalog: entry,
          lexicalCorpus: sourceView.lexicalCorpus,
          retriever: sourceDense?.queryEnabled ? 'hybrid' : 'lexical',
          vector: sourceDense?.queryEnabled ? (query, filtered) => sourceDense.rank(query, filtered) : (typeof sourceVector === 'function' ? sourceVector : null),
          relevance: (input) => relevance.judge(input),
          requestStartedAt: started,
          stageDump,
          ...(vectorBudgetMs ? { vectorBudgetMs } : {}),
          excludeIds: validation.plan.diagnostics?.excludeShown
            ? new Set(previouslyShown.filter((id) => id.startsWith(`${sourceId}:`)).map((id) => id.slice(sourceId.length + 1)))
            : undefined,
        }));
      }
      const executed = combineExecutions(executions);
      if (executed.status === 'unavailable') {
        return trialResult({
          status: 'unavailable',
          answer: UNAVAILABLE_ANSWER,
          recordIds: [],
          elapsedMs: elapsed(),
          previousPlan: sessionPlan,
          shownIds: previouslyShown,
          receipt: receiptOf('unavailable', { timings: numericTimings(executed.timings) }),
          dataAsOf: view.dataAsOf,
        });
      }
      if (executed.status === 'no_result' && executed.excludedMatches > 0) {
        return trialResult({
          status: 'completed',
          answer: noOtherAnswer(executed.excludedMatches),
          recordIds: [],
          elapsedMs: elapsed(),
          previousPlan: sessionPlan,
          shownIds: previouslyShown,
          receipt: receiptOf('no_other', { excludedMatches: executed.excludedMatches, timings: numericTimings(executed.timings) }),
          dataAsOf: view.dataAsOf,
          candidateIds: stageDump ? executed.candidateIds ?? [] : null,
        });
      }
      if (executed.status === 'no_result') {
        return trialResult({
          status: 'completed',
          answer: noResultAnswer(visibleCount),
          recordIds: [],
          elapsedMs: elapsed(),
          previousPlan: sessionPlan,
          shownIds: previouslyShown,
          receipt: receiptOf('no_result', { retriever: usesDense ? 'hybrid' : 'lexical', timings: numericTimings(executed.timings) }),
          dataAsOf: view.dataAsOf,
          candidateIds: stageDump ? executed.candidateIds ?? [] : null,
        });
      }
      const vectorStatus = executed.timings?.vectorStatus;
      if (usesDense && (vectorStatus === 'timeout' || vectorStatus === 'failed')) {
        noteDenseFallback(vectorStatus);
      }
      const body = formatRecords(executed.results, visibleCatalog);
      const notice = formatCoverageNotice(executed.coverage);
      let answer = executed.insufficient && body ? `${body}\n\n${INSUFFICIENT_NOTICE}` : body;
      if (notice) answer = answer ? `${answer}\n\n${notice}` : notice;
      return trialResult({
        status: 'completed',
        answer,
        recordIds: executed.results.map((result) => publicRecordId(result.sourceId, result.recordId)),
        elapsedMs: elapsed(),
        previousPlan: sessionPlan,
        shownIds: withShown(previouslyShown, executed.results.map((result) => publicRecordId(result.sourceId, result.recordId))),
        dataAsOf: view.dataAsOf,
        coverage: executed.coverage ?? null,
        candidateIds: stageDump ? executed.candidateIds ?? [] : null,
        receipt: receiptOf('answer', {
          resultCount: executed.results.length,
          retriever: usesDense ? 'hybrid' : 'lexical',
          timings: numericTimings(executed.timings),
        }),
      });
    },
  };
}

export async function loadRetrievalResources(env = process.env) {
  const catalog = loadCatalog(sourceIdsFromEnv(env));
  const payload = JSON.parse(await readFile(snapshotPathFromEnv(env), 'utf8'));
  if (!Array.isArray(payload?.records)) throw new Error('snapshot records must be an array');
  const records = authorizedRecords(payload.records, catalog);
  const valueIndex = buildValueIndex(records, catalog);
  const lexicalCorpus = catalog.length === 1 ? prepareLexicalCorpus(records, fieldsWithRole(catalog, 'body')) : null;
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
      memory: memoryReport(resources.records, resources.catalog),
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
    const options = {
      ...(request.pageContext ? { pageContext: request.pageContext } : {}),
      ...(request.principal ? { principal: request.principal } : {}),
    };
    const result = await answering.answer(request.question, request.session ?? null, ...(Object.keys(options).length ? [options] : []));
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
  const rankers = [];
  let answering;
  try {
    const catalog = loadCatalog(sourceIdsFromEnv(process.env));
    let resources;
    try {
      resources = await loadRetrievalResources();
    } catch {
      const view = buildCorpusView([], catalog, null);
      resources = { ...view, catalog, snapshotId: 'pending-refresh' };
    }
    const semanticEntries = catalog.filter((entry) => definitionForCatalog(entry).retrieval?.semanticSearch);
    const vectorBySource = {};
    const denseBySource = {};
    const denseConfig = denseSettings(process.env);
    for (const entry of semanticEntries) {
      try {
        const ranker = await openOptionalVector(process.env, entry.id);
        if (ranker) {
          rankers.push(ranker);
          vectorBySource[entry.id] = (query, filtered) => ranker.rank(query, filtered);
        }
      } catch { /* Keep lexical fallback when the optional vector index cannot open. */ }
      if (denseConfig.queryEnabled || denseConfig.indexEnabled) {
        // The empty suffix retains the existing store; other sources get isolated stores.
        const suffix = definitionForCatalog(entry).retrieval.denseStoreSuffix ?? entry.id;
        const dense = createDenseRuntime({ settings: {
          ...denseConfig, storePath: suffix ? `${denseConfig.storePath}.${suffix}` : denseConfig.storePath,
        } });
        denseBySource[entry.id] = dense;
        await dense.load().catch(() => 0);
        dense.schedule(resources.records.filter((record) => recordSourceId(record) === entry.id), fieldsWithRole(entry, 'body'));
      }
    }
    answering = createRetrievalAnswering({
      ...resources,
      enrichmentById: await loadEnrichmentById(),
      learnedById: await loadLearnedQueriesById(),
      denseBySource,
      vectorBySource,
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
      pending.push(answering.replaceCorpus(request).then((response) => emit({ type: 'corpus', ...response })));
      continue;
    }
    pending.push(dispatchWorkerRequest(answering, request));
  }
  await Promise.allSettled(pending);
  await emitQueue;
  for (const ranker of rankers) await ranker.close();
}

if (process.argv.includes('--hermes-ui-prefetch-worker') || process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    emit({ workerError: 'trial worker fatal error', detail: String(error?.name ?? 'Error') });
    process.exitCode = 1;
  });
}
