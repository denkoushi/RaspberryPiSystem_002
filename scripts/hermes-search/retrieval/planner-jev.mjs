// One JEV call per turn. Choice options come only from code-found candidates.
// evaluate is injectable; the default transport follows hermes-jev-record-pilot.
import { performance } from 'node:perf_hooks';
import { catalogEntries } from './catalog.mjs';
import { QUERY_PLAN_SCHEMA, hasAppliedHardFilter, shouldSkipRelevance } from './query-plan.mjs';
import { enumeratedChoiceGroups } from './value-index.mjs';
import { nextIsoDay, parsePeriods, previousIsoDay, referenceDate } from './period-parse.mjs';

const LIMIT_OPTIONS = ['1', '2', '3', '5', '10', '20'];
const LIMIT_UNSPECIFIED = 'unspecified';
const NONE = 'none';
const NOUL_ACCEPT_AT = 0.6;
const VALUE_ACCEPT_AT = 0.4;
const VALUE_LOW_AT = 0.15;
const NONE_CLARIFY_BELOW = 0.5;
const VALUE_RIVAL_GAP = 0.2;
const VALUE_CLOSE_GAP = 0.12;
const MAX_MULTI_VALUES = 8;
const OUT_OF_SCOPE = 'out_of_scope';
const RECENCY = /最近|直近|新しい順|最新/u;

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

function valuesFromAnswer(answer, options, indexedValues) {
  const probabilities = answer?.probabilities;
  if (probabilities && typeof probabilities === 'object') {
    const noneScore = Number(probabilities[NONE]);
    const ranked = options
      .filter((option) => option.id !== NONE)
      .map((option) => ({ ...option, score: Number(probabilities[option.id]) }))
      .filter((option) => Number.isFinite(option.score))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const valuesOf = (rows) => rows
      .map((option) => indexedValues[Number(option.id.slice(1))])
      .filter((value) => typeof value === 'string');
    if (!best || best.score < VALUE_LOW_AT || (Number.isFinite(noneScore) && noneScore >= NONE_CLARIFY_BELOW && noneScore >= best.score)) {
      return { kind: 'none' };
    }
    const rival = Math.max(ranked[1]?.score ?? 0, Number.isFinite(noneScore) ? noneScore : 0);
    const accepted = best.score >= VALUE_ACCEPT_AT && !(Number.isFinite(noneScore) && noneScore >= best.score);
    if (!accepted && best.score - rival < VALUE_RIVAL_GAP) {
      return { kind: 'low', values: valuesOf(ranked.filter((option) => option.score >= VALUE_LOW_AT)).slice(0, 5) };
    }
    if (!accepted) return { kind: 'none' };
    const close = ranked.filter((option) => option.score >= best.score - VALUE_CLOSE_GAP && option.score >= VALUE_ACCEPT_AT);
    const values = close.map((option) => indexedValues[Number(option.id.slice(1))]).filter((value) => typeof value === 'string');
    if (values.length > MAX_MULTI_VALUES) return { kind: 'clarify', values: values.slice(0, MAX_MULTI_VALUES) };
    return { kind: 'values', values };
  }
  const pick = chosen(answer, options.map((option) => option.id));
  if (!pick || pick === NONE) return { kind: pick ? 'none' : 'missing' };
  const value = indexedValues[Number(pick.slice(1))];
  return typeof value === 'string' ? { kind: 'values', values: [value] } : { kind: 'missing' };
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
    async plan({ question, previousPlan = null, catalog, candidates = [], valueIndex = null, choiceGroups = null, now = null }) {
      if (typeof question !== 'string' || !question.trim()) throw new TypeError('question must be a non-empty string');
      if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
      const entries = catalogEntries(catalog);
      if (!entries.length) throw new TypeError('catalog is empty');
      const enumeratedFields = entries.reduce((count, entry) => count + entry.fields.filter((field) => field.filterable && field.enumerated).length, 0);
      const fromIndex = valueIndex && typeof valueIndex === 'object';
      const linked = Array.isArray(choiceGroups);
      const usable = linked
        ? choiceGroups.filter((group) => group && group.decision !== 'none' && Array.isArray(group.values) && group.values.length)
        : fromIndex
        ? enumeratedChoiceGroups(question, valueIndex, catalog).map((group) => ({ ...group, term: group.field }))
        : candidates.filter((group) => group && typeof group.term === 'string' && group.term
          && typeof group.source === 'string' && typeof group.field === 'string'
          && Array.isArray(group.values) && group.values.length > 0 && group.values.length <= 8
          && group.values.every((value) => typeof value === 'string'));
      const asked = fromIndex ? usable : usable.slice(0, Math.max(enumeratedFields, 1));
      const questions = {};
      const optionMap = new Map();
      if (fromIndex) {
        const sourceOptions = entries.map((entry) => ({
          id: entry.id,
          description: entry.description || entry.label || entry.id,
        }));
        sourceOptions.push({ id: OUT_OF_SCOPE, description: '記録を探していない。挨拶、天気、一般知識、言葉の定義である。' });
        questions.scope = choiceQuestion(
          'この発話が探している記録の種類を選ぶ。不適合、部署、日付、件数、現象についての検索は記録の質問である。挨拶、天気、一般知識、言葉の定義だけを out_of_scope にする。',
          sourceOptions,
        );
      }
      asked.forEach((group, index) => {
        const key = fromIndex || linked ? `field_${index}` : `term_${index}`;
        if (group.decision === 'clarify') {
          optionMap.set(key, { group, options: [], clarify: true });
          return;
        }
        const options = group.values.map((value, valueIndex) => ({ id: `v${valueIndex}`, description: value }));
        options.push({ id: NONE, description: 'この語は絞り込み条件にしない' });
        questions[key] = choiceQuestion(
          fromIndex
            ? `この発話が指定している${labelOf(entries, group.source, group.field)}の値を、意味が合うものだけ選ぶ。省略、通称、一字の揺れも同じ値として扱う。指定がなければ none。`
            : `質問中の「${group.term}」に対応する${labelOf(entries, group.source, group.field)}の値を一つ選ぶ。候補にない値は作らない。該当しなければ none。`,
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
      questions.sort = choiceQuestion(
        '結果の並べ方を一つ選ぶ。内容の質問は意味の近さ順が既定。最近・直近・新しい順・最新のように新しさを求めているときだけ日付が新しい順。内容がなく絞り込みだけのときは日付が新しい順。',
        [
          { id: 'recent', description: '日付が新しい順' },
          { id: 'relevance', description: '意味の近さ順' },
        ],
      );
      const periodMatches = parsePeriods(question, now ?? referenceDate(new Date()));
      const periodChoices = periodMatches.flatMap((match) => match.interpretations);
      const periodAmbiguous = periodChoices.length > 1;
      if (periodAmbiguous) {
        const options = periodChoices.map((item, index) => ({ id: `p${index}`, description: item.label }));
        options.push({ id: NONE, description: '期間では絞らない' });
        questions.period = choiceQuestion('発話中の期間として合うものを一つ選ぶ。曖昧でなければ none。', options);
      }
      const limitOptions = LIMIT_OPTIONS.map((count) => ({ id: count, description: `${count}件` }));
      if (fromIndex) limitOptions.push({ id: LIMIT_UNSPECIFIED, description: '件数の指定はない' });
      questions.limit = choiceQuestion(
        fromIndex ? '発話が件数を明示しているときだけその件数を選ぶ。明示がなければ unspecified。' : '返す件数の上限を一つ選ぶ。',
        limitOptions,
      );
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
      const unresolved = fromIndex ? [] : usable.slice(asked.length).map((group) => ({ term: group.term, candidates: [...group.values] }));
      const scopeIds = entries.map((entry) => entry.id);
      const scopeChoice = fromIndex ? chosen(answers.scope, [...scopeIds, OUT_OF_SCOPE]) : scopeIds[0];
      const outOfScope = fromIndex && scopeChoice === OUT_OF_SCOPE;
      const selected = [];
      const resolvedTerms = [];
      if (!outOfScope) {
        for (const [key, mapped] of optionMap) {
          if (mapped.clarify) {
            unresolved.push({ term: mapped.group.field, candidates: [...mapped.group.values] });
            continue;
          }
          const picked = fromIndex || linked
            ? valuesFromAnswer(answers[key], mapped.options, mapped.group.values)
            : null;
          if (fromIndex || linked) {
            if (picked.kind === 'clarify') {
              unresolved.push({ term: mapped.group.field, candidates: picked.values });
            } else if (picked.kind === 'low') {
              unresolved.push({ term: mapped.group.field, candidates: picked.values.slice(0, 5) });
            } else if (picked.kind === 'values' && picked.values.length) {
              selected.push({
                source: mapped.group.source,
                field: mapped.group.field,
                op: picked.values.length > 1 ? 'in' : 'eq',
                values: picked.values,
              });
              resolvedTerms.push(...picked.values);
            }
            continue;
          }
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
      }
      const turn = hasPrevious ? chosen(answers.turn, ['new_search', 'refine']) : 'new_search';
      if (hasPrevious && !turn) unresolved.push({ term: 'turn', candidates: ['new_search', 'refine'] });
      const sortChoice = chosen(answers.sort, ['recent', 'relevance']);
      void sortChoice;
      const limitAllowed = fromIndex ? [...LIMIT_OPTIONS, LIMIT_UNSPECIFIED] : LIMIT_OPTIONS;
      const limitChoice = chosen(answers.limit, limitAllowed);
      const limitExplicit = fromIndex ? Boolean(limitChoice && limitChoice !== LIMIT_UNSPECIFIED) : Boolean(limitChoice);
      if (!fromIndex && !limitChoice) unresolved.push({ term: 'limit', candidates: [...LIMIT_OPTIONS] });
      const contentChoice = chosen(answers.content, ['true', 'false']);
      if (!contentChoice) unresolved.push({ term: 'content', candidates: ['true', 'false'] });

      const carried = turn === 'refine' && Array.isArray(previousPlan?.filters)
        ? previousPlan.filters
          .filter((filter) => filter && typeof filter.source === 'string' && typeof filter.field === 'string' && typeof filter.op === 'string' && Array.isArray(filter.values))
          .map((filter) => ({ source: filter.source, field: filter.field, op: filter.op, values: [...filter.values] }))
        : [];
      const plannedSources = outOfScope ? [] : (fromIndex && scopeIds.includes(scopeChoice) ? [scopeChoice] : entries.map((entry) => entry.id));
      const dateOwner = entries.find((entry) => plannedSources.includes(entry.id) && entry.fields.some((field) => field.role === 'date'));
      const dateKey = dateOwner?.fields.find((field) => field.role === 'date')?.key ?? null;
      const dated = [];
      const recentField = dateField(entries);
      if (dateOwner && dateKey && periodChoices.length) {
        let picked = periodChoices.length === 1 ? periodChoices[0] : null;
        if (periodAmbiguous) {
          const allowed = [...periodChoices.map((_, index) => `p${index}`), NONE];
          const periodChoice = chosen(answers.period, allowed);
          if (!periodChoice) unresolved.push({ term: 'period', candidates: periodChoices.map((item) => item.label) });
          else if (periodChoice !== NONE) picked = periodChoices[Number(periodChoice.slice(1))] ?? null;
        }
        const filter = picked ? periodFilter(dateOwner.id, dateKey, picked) : null;
        if (filter) dated.push(filter);
      }
      const filters = mergeFilters([...carried, ...selected, ...dated]);
      const jev = contentChoice === 'true' ? true : contentChoice === 'false' ? false : null;
      const finalContent = jev === true && unresolved.length === 0;
      const sortMode = resolveSort(question, jev, hasAppliedHardFilter({ filters }, catalog));
      const sort = sortMode === 'recent' && recentField
        ? { field: recentField, direction: 'desc' }
        : 'relevance';
      const plan = {
        schema: QUERY_PLAN_SCHEMA,
        sources: plannedSources,
        filters: outOfScope ? [] : filters,
        semanticQuery: outOfScope || unresolved.length || shouldSkipRelevance({
          filters,
          diagnostics: { contentDecision: { jev } },
        }, catalog) ? '' : question.trim(),
        sort,
        limit: limitExplicit ? Number(limitChoice) : 5,
        display: entries.flatMap((entry) => entry.fields.map((field) => field.key)),
        unresolved: outOfScope ? [] : unresolved,
        diagnostics: {
          contentDecision: { jev, residualTokens: [], final: finalContent },
          scope: outOfScope ? 'out_of_scope' : 'records',
          limitExplicit,
        },
      };
      return { plan, timings: { planMs } };
    },
  };
}

function resolveSort(question, contentJev, hardFilter) {
  const recency = RECENCY.test(String(question ?? ''));
  const filterOnly = contentJev === false && hardFilter;
  if (recency || filterOnly) return 'recent';
  return 'relevance';
}

function periodFilter(source, field, bounds) {
  if (bounds.from && bounds.to) return { source, field, op: 'between', values: [bounds.from, bounds.to] };
  if (bounds.from) return { source, field, op: 'after', values: [previousIsoDay(bounds.from)] };
  if (bounds.to) return { source, field, op: 'before', values: [nextIsoDay(bounds.to)] };
  return null;
}

function labelOf(entries, source, field) {
  const entry = entries.find((item) => item.id === source);
  return entry?.fields.find((item) => item.key === field)?.label ?? field;
}
