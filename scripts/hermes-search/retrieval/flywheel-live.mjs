// Live scoring of kept synthetic questions (hermes-synthetic-question-flywheel-execplan.md,
// Milestone 3). Each kept question is answered by the pipeline the kiosk uses (planner, hybrid
// retrieval, relevance judge) inside the runner process, and the outcome is reduced to record ids
// and a loss stage. The stage says where a question that should have shown its anchor was lost.
import { authorizedRecords } from './corpus.mjs';
import { DGX_INDEX_TIMEOUT_MS, createDenseRuntime, createDgxEmbedder, denseSettings } from './dense-dgx.mjs';
import { relevancePoolLimit } from './executor.mjs';
import { RELEVANT } from './flywheel-filter.mjs';
import { bareId } from './flywheel-pairs.mjs';
import { learnedQueriesById } from './flywheel-learn.mjs';
import { relevanceFailureReason } from './relevance-jev.mjs';
import { createRetrievalAnswering, loadEnrichmentById, loadLearnedQueriesById } from './worker.mjs';

export const LOSS_STAGES = ['status', 'not_in_pool', 'judge_rejected', 'other_shown', 'failed'];
// The day budget (1.5 s) is a kiosk latency limit, not a retrieval-quality one. At night the Pi 5
// to DGX path is slow while the DGX backup uploads (2026-10-05: connect alone 0.5 to 1.7 s, the
// embedding itself 0.03 s), and 47 of 60 live runs fell back to lexical. The night scorer waits
// longer so it measures retrieval, and still records vectorStatus.
export const NIGHT_VECTOR_BUDGET_MS = 10_000;

/** Ids a kept question may legitimately show: A, and B when both graders also gave it grade 3. */
export function relevantIds(row) {
  const ids = [bareId(row.a)];
  if (row.b && row.grades?.dgx?.b === RELEVANT && row.grades?.jev?.b === RELEVANT) ids.push(bareId(row.b));
  return ids;
}

/**
 * Where a kept question was lost; null means a relevant record was shown.
 * status: the planner answered in another form (clarification, out of scope, unavailable).
 * not_in_pool: nothing shown, and no relevant record among the judged candidates.
 * judge_rejected: nothing shown, although a relevant record reached the judge.
 * other_shown: records were shown, none of them labelled relevant (unlabelled, not known wrong).
 */
export function lossStage({ relevant, outcome, shown, candidates, judged }) {
  const wanted = new Set((relevant ?? []).map(bareId));
  if (outcome === 'answer') return (shown ?? []).map(bareId).some((id) => wanted.has(id)) ? null : 'other_shown';
  if (outcome === 'no_result' || outcome === 'no_other') {
    return (candidates ?? []).slice(0, judged).map(bareId).some((id) => wanted.has(id)) ? 'judge_rejected' : 'not_in_pool';
  }
  return 'status';
}

/**
 * Builds the scorer: the kiosk's answering over the same corpus, enrichment, and dense vectors.
 * Night-time query embedding may wait behind bulk embedding, so it gets the index timeout rather
 * than the day budget; `vectorStatus` in each result shows when the dense path still fell back.
 * The runner never refreshes the dense index; the worker owns that.
 */
export async function createLiveScorer({ records, catalog, evaluate, env = process.env, vectorBudgetMs = NIGHT_VECTOR_BUDGET_MS, learned = null }) {
  const settings = denseSettings(env);
  let dense = null;
  if (settings.queryEnabled && settings.origin) {
    dense = createDenseRuntime({
      settings: { ...settings, indexEnabled: false },
      embedQuery: createDgxEmbedder({ baseUrl: settings.origin, token: settings.token, egress: settings.egress, timeoutMs: DGX_INDEX_TIMEOUT_MS }).embed,
    });
    await dense.load().catch(() => 0);
  }
  const enrichmentById = await loadEnrichmentById(env);
  const learnedById = learned ? learnedQueriesById(learned, { states: null }) : await loadLearnedQueriesById(env);
  const answering = createRetrievalAnswering({
    records: authorizedRecords(records),
    catalog,
    evaluate,
    dense,
    enrichmentById,
    learnedById,
  });
  const judged = relevancePoolLimit({}, env);
  return async function score(row) {
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    try {
      const result = await answering.answer(row.question, null, { stageDump: true, vectorBudgetMs });
      const outcome = result.receipt?.outcome ?? result.status;
      const shown = (result.recordIds ?? []).map(bareId);
      const candidates = (result.candidateIds ?? []).slice(0, judged).map(bareId);
      return {
        outcome,
        reason: outcome === 'unavailable' || outcome === 'failed' ? result.receipt?.reason ?? result.reason ?? null : null,
        shown,
        candidates,
        judged,
        loss: lossStage({ relevant: relevantIds(row), outcome, shown, candidates, judged }),
        vectorStatus: result.receipt?.timings?.vectorStatus ?? null,
        plan: result.receipt?.plan ?? null,
        ms: ms(),
      };
    } catch (error) {
      const message = String(error?.message ?? 'live scoring failed')
        .replace(/Bearer\s+\S+|(?:api[_-]?key|token|authorization)\s*[:=]\s*\S+/giu, '[redacted]')
        .replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 200);
      const diagnostic = relevanceFailureReason(error).replace(/^relevance judgment failed:?\s*/u, '');
      const reason = diagnostic ? `${message} (${diagnostic})` : message;
      return { outcome: 'failed', reason, shown: [], candidates: [], judged, loss: 'failed', vectorStatus: null, plan: null, ms: ms() };
    }
  };
}
