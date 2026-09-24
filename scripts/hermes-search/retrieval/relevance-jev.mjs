// One JEV call judges up to 15 retrieved candidates. evaluate is injectable.
import { performance } from 'node:perf_hooks';

export const RELEVANCE_ACCEPT_AT = 0.5;
export const RELEVANCE_CANDIDATE_LIMIT = 15;
const BODY_CHAR_LIMIT = 300;

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

export function createRelevanceJudge({ evaluate = defaultEvaluate } = {}) {
  if (typeof evaluate !== 'function') throw new TypeError('evaluate must be a function');
  return {
    async judge({ semanticQuery, candidates, bodyFields }) {
      const query = String(semanticQuery ?? '').trim();
      if (!query) return { ok: true, ranked: [], relevanceMs: 0 };
      const selected = (Array.isArray(candidates) ? candidates : []).slice(0, RELEVANCE_CANDIDATE_LIMIT);
      if (!selected.length) return { ok: true, ranked: [], relevanceMs: 0 };
      const questions = {};
      const ids = [];
      selected.forEach((candidate, index) => {
        const key = `candidate_${index}`;
        ids.push(candidate.id);
        const body = candidateBody(candidate.record, bodyFields);
        questions[key] = {
          type: 'noul',
          instructions: `求められている現象は「${query}」そのものである。この記録の本文は、その現象を明示的に記述しているか。関連する部品や工程だけの記載、または別の事象は、記述していることにならない。\n\n記録本文:\n${body}`,
          criteria: {
            true: 'この記録は、求められている現象そのものを明示的に記述している。関連する部品や工程だけの記載では足りない。',
            false: 'この記録は、求められている現象そのものを明示的に記述していない。関連する部品や工程だけの記載、または別の事象である。',
          },
        };
      });
      const started = performance.now();
      let evaluated;
      try {
        evaluated = await evaluate({
          model: 'typesafe-ai/jev',
          state: {
            request: query,
            relatedHistory: [],
            confirmationPending: null,
          },
          questions,
          maxRetries: 0,
        });
      } catch (error) {
        const failure = new Error(String(error?.message ?? error ?? 'relevance judgment failed').slice(0, 300));
        failure.relevanceMs = Math.round(performance.now() - started);
        throw failure;
      }
      const relevanceMs = Math.round(performance.now() - started);
      const answers = answersOf(evaluated);
      if (!answers) {
        const failure = new Error('relevance judgment unavailable');
        failure.relevanceMs = relevanceMs;
        throw failure;
      }
      const ranked = [];
      ids.forEach((id, index) => {
        const probability = probabilityOf(answers[`candidate_${index}`]);
        if (probability == null || probability < RELEVANCE_ACCEPT_AT) return;
        ranked.push({ id, probability });
      });
      ranked.sort((left, right) => right.probability - left.probability || String(left.id).localeCompare(String(right.id)));
      return { ok: true, ranked, relevanceMs };
    },
  };
}
