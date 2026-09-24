// One JEV call per turn. Choice options come only from code-found candidates.
// evaluate is injectable; the default transport follows hermes-jev-record-pilot.
import { performance } from 'node:perf_hooks';
import { catalogEntries } from './catalog.mjs';
import { QUERY_PLAN_SCHEMA } from './query-plan.mjs';
import { contentQuery, contentTokens, stripListedTerms } from './structural-text.mjs';

const LIMIT_OPTIONS = ['1', '2', '3', '5', '10', '20'];
const NONE = 'none';
const NOUL_ACCEPT_AT = 0.6;

function choiceQuestion(instructions, options) {
  return {
    type: 'choice',
    instructions,
    criteria: Object.fromEntries(options.map((option) => [option.id, option.description])),
  };
}

function buildRequest(question, previousPlan) {
  if (!previousPlan || typeof previousPlan !== 'object') return question;
  const summary = {
    sources: previousPlan.sources ?? [],
    filters: previousPlan.filters ?? [],
    semanticQuery: typeof previousPlan.semanticQuery === 'string' ? previousPlan.semanticQuery : '',
    sort: previousPlan.sort ?? null,
    limit: previousPlan.limit ?? null,
  };
  return `${question}\n\nprevious_plan:\n${JSON.stringify(summary)}`;
}

function answersOf(result) {
  return result?.answers && typeof result.answers === 'object' ? result.answers : {};
}

function chosen(answer, allowedIds) {
  if (!answer || typeof answer !== 'object') return null;
  if (answer.type === 'choice' && allowedIds.includes(answer.choice)) return answer.choice;
  if (answer.type === 'noul' && allowedIds.includes('true') && allowedIds.includes('false')) {
    if (typeof answer.noul === 'boolean') return answer.noul ? 'true' : 'false';
    if (typeof answer.noul === 'number' && Number.isFinite(answer.noul)) return answer.noul >= NOUL_ACCEPT_AT ? 'true' : 'false';
  }
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== 'object') return null;
  let best = null;
  let bestScore = -1;
  for (const id of allowedIds) {
    const score = Number(probabilities[id]);
    if (Number.isFinite(score) && score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

function dateField(entries) {
  for (const entry of entries) {
    const field = entry.fields.find((item) => item.role === 'date');
    if (field) return field.key;
  }
  for (const entry of entries) {
    const field = entry.fields.find((item) => item.role === 'identifier');
    if (field) return field.key;
  }
  return null;
}

function catalogTerms(entries) {
  const terms = [];
  for (const entry of entries) {
    if (typeof entry.label === 'string' && entry.label && entry.label !== entry.id) terms.push(entry.label);
    for (const field of entry.fields) {
      if (typeof field.label === 'string' && field.label) terms.push(field.label);
    }
  }
  return terms;
}

function semanticText(question, resolvedTerms, entries) {
  return contentQuery(stripListedTerms(question, [...resolvedTerms, ...catalogTerms(entries)]));
}

function mergeFilters(filters) {
  const merged = [];
  for (const filter of filters) {
    const existing = merged.find((item) => item.source === filter.source && item.field === filter.field && (item.op === 'eq' || item.op === 'in') && (filter.op === 'eq' || filter.op === 'in'));
    if (!existing) {
      merged.push({ ...filter, values: [...filter.values] });
      continue;
    }
    for (const value of filter.values) {
      if (!existing.values.includes(value)) existing.values.push(value);
    }
    existing.op = existing.values.length > 1 ? 'in' : 'eq';
  }
  return merged;
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

export function createPlanner({ evaluate = defaultEvaluate } = {}) {
  if (typeof evaluate !== 'function') throw new TypeError('evaluate must be a function');
  return {
    async plan({ question, previousPlan = null, catalog, candidates = [] }) {
      if (typeof question !== 'string' || !question.trim()) throw new TypeError('question must be a non-empty string');
      if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
      const entries = catalogEntries(catalog);
      if (!entries.length) throw new TypeError('catalog is empty');
      const enumeratedFields = entries.reduce((count, entry) => count + entry.fields.filter((field) => field.filterable && field.enumerated).length, 0);
      const usable = candidates.filter((group) => group && typeof group.term === 'string' && group.term
        && typeof group.source === 'string' && typeof group.field === 'string'
        && Array.isArray(group.values) && group.values.length > 0 && group.values.length <= 8
        && group.values.every((value) => typeof value === 'string'));
      const asked = usable.slice(0, Math.max(enumeratedFields, 1));
      const questions = {};
      const optionMap = new Map();
      asked.forEach((group, index) => {
        const key = `term_${index}`;
        const options = group.values.map((value, valueIndex) => ({ id: `v${valueIndex}`, description: value }));
        options.push({ id: NONE, description: 'この語は絞り込み条件にしない' });
        questions[key] = choiceQuestion(
          `質問中の「${group.term}」に対応する${labelOf(entries, group.source, group.field)}の値を一つ選ぶ。候補にない値は作らない。該当しなければ none。`,
          options,
        );
        optionMap.set(key, { group, options });
      });
      const hasPrevious = Boolean(previousPlan && typeof previousPlan === 'object');
      if (hasPrevious) {
        questions.turn = choiceQuestion('この発話は直前の検索計画の更新か、新しい検索か。', [
          { id: 'new_search', description: '直前の計画は使わず、今回の発話だけで検索する' },
          { id: 'refine', description: '直前の計画を土台に、今回選んだ条件で更新する' },
        ]);
      }
      questions.sort = choiceQuestion('結果の並べ方を一つ選ぶ。', [
        { id: 'recent', description: '日付が新しい順' },
        { id: 'relevance', description: '意味の近さ順' },
      ]);
      questions.limit = choiceQuestion('返す件数の上限を一つ選ぶ。', LIMIT_OPTIONS.map((count) => ({
        id: count,
        description: `${count}件`,
      })));
      questions.content = {
        type: 'noul',
        instructions: '質問は、組織・日付の順序・件数とは別に、何が起きたか（現象・不具合・原因・処置）という内容条件を指定しているか。',
        criteria: {
          true: '現象、不具合、原因、処置などの内容条件が指定されている。',
          false: '組織、日付の順序、件数だけで、内容条件はない。',
        },
      };

      const started = performance.now();
      const evaluated = await evaluate({
        model: 'typesafe-ai/jev',
        state: {
          request: buildRequest(question, hasPrevious ? previousPlan : null),
          relatedHistory: [],
          confirmationPending: null,
        },
        questions,
        maxRetries: 0,
      });
      const planMs = Math.round(performance.now() - started);
      const answers = answersOf(evaluated);
      const unresolved = usable.slice(asked.length).map((group) => ({ term: group.term, candidates: [...group.values] }));
      const selected = [];
      const resolvedTerms = [];
      for (const [key, mapped] of optionMap) {
        const allowed = mapped.options.map((option) => option.id);
        const pick = chosen(answers[key], allowed);
        if (!pick || pick === NONE) {
          if (!pick) unresolved.push({ term: mapped.group.term, candidates: [...mapped.group.values] });
          continue;
        }
        const option = mapped.options.find((item) => item.id === pick);
        const value = mapped.group.values[Number(pick.slice(1))];
        if (!option || option.id === NONE || typeof value !== 'string') {
          unresolved.push({ term: mapped.group.term, candidates: [...mapped.group.values] });
          continue;
        }
        selected.push({ source: mapped.group.source, field: mapped.group.field, op: 'eq', values: [value] });
        resolvedTerms.push(mapped.group.term);
      }
      const turn = hasPrevious ? chosen(answers.turn, ['new_search', 'refine']) : 'new_search';
      if (hasPrevious && !turn) unresolved.push({ term: 'turn', candidates: ['new_search', 'refine'] });
      const sortChoice = chosen(answers.sort, ['recent', 'relevance']);
      if (!sortChoice) unresolved.push({ term: 'sort', candidates: ['recent', 'relevance'] });
      const limitChoice = chosen(answers.limit, LIMIT_OPTIONS);
      if (!limitChoice) unresolved.push({ term: 'limit', candidates: [...LIMIT_OPTIONS] });
      const contentChoice = chosen(answers.content, ['true', 'false']);
      if (!contentChoice) unresolved.push({ term: 'content', candidates: ['true', 'false'] });

      const carried = turn === 'refine' && Array.isArray(previousPlan?.filters)
        ? previousPlan.filters
          .filter((filter) => filter && typeof filter.source === 'string' && typeof filter.field === 'string' && typeof filter.op === 'string' && Array.isArray(filter.values))
          .map((filter) => ({ source: filter.source, field: filter.field, op: filter.op, values: [...filter.values] }))
        : [];
      const filters = mergeFilters([...carried, ...selected]);
      const residual = semanticText(question, resolvedTerms, entries);
      const residualTokens = contentTokens(residual);
      const jev = contentChoice === 'true' ? true : contentChoice === 'false' ? false : null;
      const finalContent = residualTokens.length > 0 || jev === true;
      let semanticQuery = '';
      if (residualTokens.length > 0) semanticQuery = residual;
      else if (finalContent && turn === 'refine' && typeof previousPlan?.semanticQuery === 'string') {
        semanticQuery = previousPlan.semanticQuery;
      }
      const recentField = dateField(entries);
      const sort = sortChoice === 'recent' && recentField
        ? { field: recentField, direction: 'desc' }
        : 'relevance';
      const plan = {
        schema: QUERY_PLAN_SCHEMA,
        sources: entries.map((entry) => entry.id),
        filters,
        semanticQuery,
        sort,
        limit: limitChoice ? Number(limitChoice) : 5,
        display: entries.flatMap((entry) => entry.fields.map((field) => field.key)),
        unresolved,
        diagnostics: {
          contentDecision: { jev, residualTokens, final: finalContent },
        },
      };
      return { plan, timings: { planMs } };
    },
  };
}

function labelOf(entries, source, field) {
  const entry = entries.find((item) => item.id === source);
  return entry?.fields.find((item) => item.key === field)?.label ?? field;
}
