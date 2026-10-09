// One JEV call judges up to 15 retrieved candidates; a larger pool is judged in parallel calls
// of 15, so each call keeps the same size. evaluate is injectable.
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export const RELEVANCE_ACCEPT_AT = 0.5;
export const RELEVANCE_CANDIDATE_LIMIT = 15;
const BODY_CHAR_LIMIT = 300;
const FAILURE_CODES = new Set(['upstream_http', 'timeout', 'connection_failed', 'invalid_json', 'invalid_answers', 'missing_credentials', 'transport_unavailable']);
const RETRY_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

export function relevanceFailureReason(error) {
  const diagnostic = error?.hermesDiagnostic;
  const code = FAILURE_CODES.has(diagnostic?.failureCode) ? diagnostic.failureCode : null;
  const status = Number.isInteger(diagnostic?.httpStatus) && diagnostic.httpStatus >= 100 && diagnostic.httpStatus <= 599
    ? ` ${diagnostic.httpStatus}` : '';
  if (code) return `relevance judgment failed: ${code}${status}`;
  // Other providers carry no diagnostic; keep a short, sanitised message so the receipt still says what happened.
  const message = String(error?.message ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 120);
  return message && !/^relevance judgment failed/u.test(message) ? `relevance judgment failed: ${message}` : (message || 'relevance judgment failed');
}

function retryable(error) {
  const diagnostic = error?.hermesDiagnostic;
  return diagnostic?.failureCode === 'timeout' || diagnostic?.failureCode === 'connection_failed'
    || diagnostic?.failureCode === 'upstream_http' && RETRY_HTTP_STATUSES.has(diagnostic.httpStatus);
}

function answersOf(result) {
  return result?.answers && typeof result.answers === 'object' ? result.answers : null;
}

function probabilityOf(answer) {
  if (!answer || answer.type !== 'noul') return null;
  if (typeof answer.noul === 'number' && Number.isFinite(answer.noul)) return answer.noul;
  if (typeof answer.noul === 'boolean') return answer.noul ? 1 : 0;
  return null;
}

export function candidateBody(record, bodyFields) {
  const parts = [];
  for (const key of bodyFields ?? []) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) parts.push(value.trim());
  }
  return parts.join('\n').slice(0, BODY_CHAR_LIMIT);
}

async function defaultEvaluate(input) {
  const provider = process.env.HERMES_JEV_PROVIDER;
  const payload = { ...input, model: 'typesafe-ai/jev', maxRetries: 0 };
  if (provider === 'typesafe-direct' || (provider == null && process.env.TYPESAFE_API_KEY)) {
    const { createTypesafeDirectEvaluate } = await import('../hermes-jev-record-pilot.mjs');
    return createTypesafeDirectEvaluate()(payload);
  }
  if (provider && provider !== 'vercel-ai-gateway') {
    throw new Error(`unsupported HERMES_JEV_PROVIDER: ${provider}`);
  }
  const { experimental_evaluate: evaluate } = await import('ai');
  return evaluate(payload);
}

export function createRelevanceJudge({ evaluate = defaultEvaluate, sleep = delay } = {}) {
  if (typeof evaluate !== 'function') throw new TypeError('evaluate must be a function');
  if (typeof sleep !== 'function') throw new TypeError('sleep must be a function');
  return {
    async judge({ semanticQuery, candidates, bodyFields, poolLimit = RELEVANCE_CANDIDATE_LIMIT }) {
      const query = String(semanticQuery ?? '').trim();
      if (!query) return { ok: true, ranked: [], relevanceMs: 0, attempts: 0 };
      const pool = (Array.isArray(candidates) ? candidates : []).slice(0, Math.max(poolLimit, RELEVANCE_CANDIDATE_LIMIT));
      if (!pool.length) return { ok: true, ranked: [], relevanceMs: 0, attempts: 0 };
      const started = performance.now();
      const batches = [];
      for (let index = 0; index < pool.length; index += RELEVANCE_CANDIDATE_LIMIT) {
        batches.push(pool.slice(index, index + RELEVANCE_CANDIDATE_LIMIT));
      }
      let judged;
      // Attempts is the maximum per batch, not the number of parallel batches.
      let attempts = 1;
      try {
        judged = await Promise.all(batches.map((batch) => judgeBatch(query, batch, bodyFields, () => { attempts = 2; })));
      } catch (error) {
        error.relevanceMs = Math.round(performance.now() - started);
        error.attempts = attempts;
        throw error;
      }
      const ranked = judged.flat();
      ranked.sort((left, right) => right.probability - left.probability || String(left.id).localeCompare(String(right.id)));
      return { ok: true, ranked, relevanceMs: Math.round(performance.now() - started), attempts };
    },
  };

  async function judgeBatch(query, selected, bodyFields, onRetry) {
      const questions = {};
      const ids = [];
      selected.forEach((candidate, index) => {
        const key = `candidate_${index}`;
        ids.push(candidate.id);
        const body = candidateBody(candidate.record, bodyFields);
        questions[key] = {
          type: 'noul',
          instructions: `組織・日付・件数は判断に使わない。求められている現象は、質問が指定する現象そのものである。この記録の本文は、その現象を明示的に記述しているか。関連する、隣接する、または別の現象、あるいは部品や工程の語を共有するだけの記載は、記述していることにならない。\n\n質問:\n${query}\n\n記録本文:\n${body}`,
          criteria: {
            true: 'この記録は、求められている現象そのものを明示的に記述している。関連・隣接・別の現象、または部品や工程の語だけの記載では足りない。組織・日付・件数は判断に使わない。',
            false: 'この記録は、求められている現象そのものを明示的に記述していない。関連する、隣接する、または別の現象であるか、部品や工程の語を共有しているだけである。',
          },
        };
      });
      const started = performance.now();
      let evaluated;
      const input = {
          model: 'typesafe-ai/jev',
          state: {
            request: query,
            relatedHistory: [],
            confirmationPending: null,
          },
          questions,
          maxRetries: 0,
      };
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          evaluated = await evaluate(input);
          break;
        } catch (error) {
          if (attempt === 1 && retryable(error)) {
            onRetry();
            await sleep(2000);
            continue;
          }
          const failure = new Error(relevanceFailureReason(error));
          if (error?.hermesDiagnostic) failure.hermesDiagnostic = error.hermesDiagnostic;
          failure.relevanceMs = Math.round(performance.now() - started);
          throw failure;
        }
      }
      const relevanceMs = Math.round(performance.now() - started);
      const answers = answersOf(evaluated);
      if (!answers) {
        const failure = new Error('relevance judgment failed: invalid_answers');
        failure.hermesDiagnostic = { failureCode: 'invalid_answers' };
        failure.relevanceMs = relevanceMs;
        throw failure;
      }
      const ranked = [];
      ids.forEach((id, index) => {
        const probability = probabilityOf(answers[`candidate_${index}`]);
        if (probability == null || probability < RELEVANCE_ACCEPT_AT) return;
        ranked.push({ id, probability });
      });
      return ranked;
  }
}
