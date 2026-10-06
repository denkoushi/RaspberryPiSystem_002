// One JEV call per turn. Choice options come only from code-found candidates.
// evaluate is injectable; the default transport follows hermes-jev-record-pilot.
import { performance } from 'node:perf_hooks';
import { catalogEntries } from './catalog.mjs';
import { QUERY_PLAN_SCHEMA, hasAppliedHardFilter, shouldSkipRelevance } from './query-plan.mjs';
import { contentSpans } from './structural-text.mjs';
import { enumeratedChoiceGroups } from './value-index.mjs';
import { nextIsoDay, parsePeriods, previousIsoDay, referenceDate } from './period-parse.mjs';

const LIMIT_OPTIONS = ['1', '2', '3', '5', '10', '20'];
const LIMIT_UNSPECIFIED = 'unspecified';
const NONE = 'none';
const NOUL_ACCEPT_AT = 0.6;
// Hiding records already shown only hides what the person has seen, and an empty result says so,
// so short requests such as 「他にはある？」 (0.52 on 2026-09-29) are accepted. Scope or count changes
// scored 0.14 to 0.44.
const EXCLUDE_SHOWN_ACCEPT_AT = 0.5;
const VALUE_ACCEPT_AT = 0.4;
const VALUE_LOW_AT = 0.15;
const NONE_CLARIFY_BELOW = 0.5;
const VALUE_RIVAL_GAP = 0.2;
const VALUE_CLOSE_GAP = 0.12;
const MAX_MULTI_VALUES = 8;
const OUT_OF_SCOPE = 'out_of_scope';
const OUT_OF_SCOPE_MARGIN = 0.2;
const RECENCY = /最近|直近|新しい順|最新/u;

function choiceQuestion(instructions, options) {
  return {
    type: 'choice',
    instructions,
    criteria: Object.fromEntries(options.map((option) => [option.id, option.description])),
  };
}

// The previous plan is a named state field, separate from `request`, so JEV judges
// content, limit, and filter values from the current utterance alone.
function previousPlanSummary(previousPlan) {
  if (!previousPlan || typeof previousPlan !== 'object') return null;
  const summary = {
    sources: previousPlan.sources ?? [],
    filters: previousPlan.filters ?? [],
    semanticQuery: typeof previousPlan.semanticQuery === 'string' ? previousPlan.semanticQuery : '',
    sort: previousPlan.sort ?? null,
    limit: previousPlan.limit ?? null,
  };
  return summary;
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

// Decision receipt: which option each question chose, with its confidence and the top
// alternatives. Choice ids are mapped to their option text so a field answer reads as the
// chosen value. The receipt holds no record text.
export const PLANNER_QUESTION_VERSION = 'planner-questions-2026-09-30';

// Choice ids that read on their own in a receipt; other choices map to their option text.
const PLAIN_CHOICE = /^(?:sort|scope|limit|period|contentCarry)$/u;

export function summarizeAnswers(questions, answers) {
  const summary = {};
  for (const [id, question] of Object.entries(questions ?? {})) {
    const answer = answers?.[id];
    if (!answer || typeof answer !== 'object') {
      summary[id] = { missing: true };
      continue;
    }
    if (question?.type === 'choice') {
      const label = (option) => (PLAIN_CHOICE.test(id)
        ? option
        : (question.criteria?.[option] ?? option));
      const probabilities = answer.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities : {};
      const top = Object.entries(probabilities)
        .filter(([, value]) => Number.isFinite(Number(value)))
        .sort((left, right) => Number(right[1]) - Number(left[1]))
        .slice(0, 3)
        .map(([option, value]) => [label(option), Number(Number(value).toFixed(3))]);
      summary[id] = {
        choice: typeof answer.choice === 'string' ? label(answer.choice) : null,
        ...(Number.isFinite(Number(answer.confidence)) ? { confidence: Number(Number(answer.confidence).toFixed(3)) } : {}),
        ...(top.length ? { top } : {}),
      };
    } else if (question?.type === 'noul') {
      summary[id] = { noul: typeof answer.noul === 'number' ? Number(answer.noul.toFixed(3)) : answer.noul ?? null };
    } else {
      summary[id] = { answered: true };
    }
  }
  return summary;
}

function chosen(answer, allowedIds, acceptAt = NOUL_ACCEPT_AT) {
  if (!answer || typeof answer !== 'object') return null;
  if (answer.type === 'choice' && allowedIds.includes(answer.choice)) return answer.choice;
  if (answer.type === 'noul' && allowedIds.includes('true') && allowedIds.includes('false')) {
    if (typeof answer.noul === 'boolean') return answer.noul ? 'true' : 'false';
    if (typeof answer.noul === 'number' && Number.isFinite(answer.noul)) return answer.noul >= acceptAt ? 'true' : 'false';
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

// Follow-up turns decide each condition of the previous plan on its own instead of one
// new-search-or-refine label for the whole turn, so a request can keep one condition,
// replace another, and add to a third. Whether the request names a new value for the same
// field comes from the value questions; JEV answers only yes/no questions: does the request
// drop the condition, and does it add to the previous values. A probe on 2026-09-30 showed a
// three-way keep/replace/add choice kept the previous department for 「組立１課の不適合２件」
// and 「部署を問わずに」. The number of questions grows with the previous conditions, not with
// wordings.
const CONTENT_CARRY_OPTIONS = [
  { id: 'same', description: '`request` は新しい内容を述べていない。`previous_plan` の内容を指す言い方か、組織・期間・件数などの条件だけを変えている' },
  { id: 'new', description: '`request` が `previous_plan` とは別の、何が起きたか（現象・不具合・原因・処置）を述べている' },
];

function validFilter(filter) {
  return filter && typeof filter.source === 'string' && typeof filter.field === 'string'
    && typeof filter.op === 'string' && Array.isArray(filter.values);
}

function conditionText(entries, filter) {
  const label = labelOf(entries, filter.source, filter.field);
  const values = filter.values.map(String);
  if (filter.op === 'between') return `${label}が${values[0]}から${values[1]}まで`;
  if (filter.op === 'after') return `${label}が${values[0]}より後`;
  if (filter.op === 'before') return `${label}が${values[0]}より前`;
  return `${label}が${values.join('、')}`;
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
    async plan({ question, previousPlan = null, catalog, candidates = [], valueIndex = null, choiceGroups = null, now = null, shownCount = 0, pageContext = null }) {
      if (typeof question !== 'string' || !question.trim()) throw new TypeError('question must be a non-empty string');
      if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
      const currentEntity = /この|現在の|いまの|今の/u.test(question) ? pageContext?.entity : null;
      const hasPrevious = Boolean(previousPlan && typeof previousPlan === 'object');
      // With a previous plan in state, name `request` so each judgment reads the current
      // utterance. First turns keep the original wording.
      const said = (original, named) => (hasPrevious ? named : original);
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
        const catalogText = sourceOptions.map((option) => option.description).join('。');
        sourceOptions.push({
          id: OUT_OF_SCOPE,
          description: `天気、食事、スポーツ、旅行、雑談のように、作業・品質・工程・設計・調達の出来事ではない発話。迷う場合は「${catalogText}」側。`,
        });
        questions.scope = choiceQuestion(
          `${said('この発話', '`request`')}が探している記録の種類を選ぶ。カタログは「${catalogText}」。図面、設計、工程、品質、調達など、その記録になりうる作業上の出来事は対象にする。out_of_scope は明らかに無関係なときだけ。`,
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
            ? `${said('この発話', '`request`')}が指定している${labelOf(entries, group.source, group.field)}の値を、意味が合うものだけ選ぶ。省略、通称、一字の揺れも同じ値として扱う。指定がなければ none。`
            : `${said('質問', '`request`')}中の「${group.term}」に対応する${labelOf(entries, group.source, group.field)}の値を一つ選ぶ。候補にない値は作らない。該当しなければ none。`,
          options,
        );
        optionMap.set(key, { group, options });
      });
      const previousFilters = hasPrevious && Array.isArray(previousPlan.filters) ? previousPlan.filters.filter(validFilter) : [];
      previousFilters.forEach((filter, index) => {
        const condition = conditionText(entries, filter);
        questions[`drop_${index}`] = {
          type: 'noul',
          instructions: `\`request\` は、\`previous_plan\` の条件「${condition}」を外す、またはその項目を問わないことを求めているか。`,
          criteria: {
            true: 'この条件を外す、またはこの項目を問わない。',
            false: 'この条件に触れていない、または別の値を指定している。',
          },
        };
        if (filter.op === 'eq' || filter.op === 'in') {
          questions[`add_${index}`] = {
            type: 'noul',
            instructions: `\`request\` は、\`previous_plan\` の条件「${condition}」を残したまま、同じ項目の別の値も対象に加えることを求めているか。`,
            criteria: {
              true: '前の値を残し、別の値も加えて両方を対象にする。',
              false: '前の値を残さずに替える、この項目に触れていない、または加える値がない。',
            },
          };
        }
      });
      const previousQuery = hasPrevious && typeof previousPlan.semanticQuery === 'string' ? previousPlan.semanticQuery.trim() : '';
      if (previousQuery) {
        questions.contentCarry = choiceQuestion(
          '`request` の内容条件（何が起きたか）を、`previous_plan` の内容条件と比べて一つ選ぶ。',
          CONTENT_CARRY_OPTIONS,
        );
      }
      questions.sort = choiceQuestion(
        said('', '`request` に合う') + '結果の並べ方を一つ選ぶ。内容の質問は意味の近さ順が既定。最近・直近・新しい順・最新のように新しさを求めているときだけ日付が新しい順。内容がなく絞り込みだけのときは日付が新しい順。',
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
        questions.period = choiceQuestion(said('発話', '`request` ') + '中の期間として合うものを一つ選ぶ。曖昧でなければ none。', options);
      }
      const limitOptions = LIMIT_OPTIONS.map((count) => ({ id: count, description: `${count}件` }));
      if (fromIndex) limitOptions.push({ id: LIMIT_UNSPECIFIED, description: '件数の指定はない' });
      questions.limit = choiceQuestion(
        fromIndex ? said('発話', '`request`') + 'が件数を明示しているときだけその件数を選ぶ。明示がなければ unspecified。' : said('返す件数の上限を一つ選ぶ。', '`request` に合う件数の上限を一つ選ぶ。'),
        limitOptions,
      );
      // Asked only when earlier answers showed records. The intent (records other than the ones already
      // shown) is judged by JEV, so no list of wordings such as ほかに or それ以外 is kept in code.
      if (hasPrevious && shownCount > 0) {
        questions.excludeShown = {
          type: 'noul',
          instructions: '`request` は、この会話ですでに示した記録そのものを除くように求めているか。範囲や条件を変える・広げる・絞る、件数を変えるだけの依頼では除かない。',
          criteria: {
            true: 'すでに示した記録を除いて、残りやまだ示していない記録を求めている。',
            false: '範囲・条件・件数を変える依頼、または新しい検索で、すでに示した記録を含めてよい。',
          },
        };
      }
      // The relevance judge rejects a matching record when the query still carries request wording such
      // as 「…はほかにある」 (2026-09-29), so JEV picks the part that states the content condition.
      const spans = contentSpans(question);
      if (spans.length) {
        questions.contentSpan = choiceQuestion(
          said('質問', '`request`') + 'のうち、探したい記録の内容を表している部分を一つ選ぶ。すでに示した記録を除く指示や、依頼・問いかけの言い回しは含めない。',
          spans.map((span, index) => ({ id: `s${index}`, description: span })),
        );
      }
      if (!previousQuery) questions.content = {
        type: 'noul',
        instructions: said('質問', '`request`') + 'は、組織・日付の順序・件数とは別に、何が起きたか（現象・不具合・原因・処置）という内容条件を指定しているか。',
        criteria: {
          true: '現象、不具合、原因、処置などの内容条件が指定されている。',
          false: '組織、日付の順序、件数だけで、内容条件はない。',
        },
      };

      const started = performance.now();
      const evaluated = await evaluate({
        model: 'typesafe-ai/jev',
        state: {
          request: question,
          ...(currentEntity ? { page_context: { kind: currentEntity.kind, value: currentEntity.value } } : {}),
          ...(hasPrevious ? { previous_plan: previousPlanSummary(previousPlan) } : {}),
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
      const scopeChoice = fromIndex ? scopeChoiceOf(answers.scope, scopeIds) : scopeIds[0];
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
      const sortChoice = chosen(answers.sort, ['recent', 'relevance']);
      void sortChoice;
      const limitAllowed = fromIndex ? [...LIMIT_OPTIONS, LIMIT_UNSPECIFIED] : LIMIT_OPTIONS;
      const limitChoice = chosen(answers.limit, limitAllowed);
      const limitExplicit = fromIndex ? Boolean(limitChoice && limitChoice !== LIMIT_UNSPECIFIED) : Boolean(limitChoice);
      if (!fromIndex && !limitChoice) unresolved.push({ term: 'limit', candidates: [...LIMIT_OPTIONS] });
      const contentCarry = previousQuery ? chosen(answers.contentCarry, CONTENT_CARRY_OPTIONS.map((option) => option.id)) : null;
      const contentChoice = previousQuery
        ? (contentCarry ? 'true' : null)
        : chosen(answers.content, ['true', 'false']);
      const spanChoice = spans.length ? chosen(answers.contentSpan, spans.map((_, index) => `s${index}`)) : null;
      const contentSpan = spanChoice ? spans[Number(spanChoice.slice(1))] : null;
      const excludeShown = questions.excludeShown ? chosen(answers.excludeShown, ['true', 'false'], EXCLUDE_SHOWN_ACCEPT_AT) === 'true' : false;
      if (!contentChoice) unresolved.push({ term: 'content', candidates: ['true', 'false'] });

      let plannedSources = outOfScope ? [] : (fromIndex && scopeIds.includes(scopeChoice) ? [scopeChoice] : entries.map((entry) => entry.id));
      // Page identifiers are already known by the screen; their use is gated in code,
      // rather than depending on a model's choice of candidate values.
      const pageFilters = [];
      let pageContextUsed = false;
      if (currentEntity && !outOfScope) {
        if (currentEntity.kind === 'procedureId') {
          if (entries.some((entry) => entry.id === 'knowledge_procedure')) {
            plannedSources = ['knowledge_procedure'];
            pageContextUsed = true;
          }
        } else {
          const owners = entries.filter((entry) => entry.fields.some((field) => field.key === currentEntity.kind && field.filterable)
            && (currentEntity.kind !== 'drawingNumber' || entry.id === 'knowledge_procedure'));
          const selectedOwners = owners.filter((entry) => plannedSources.includes(entry.id));
          const targets = selectedOwners.length ? selectedOwners : owners.slice(0, 1);
          if (targets.length) {
            plannedSources = targets.map((entry) => entry.id);
            pageFilters.push(...targets.map((entry) => ({ source: entry.id, field: currentEntity.kind, op: 'eq', values: [currentEntity.value] })));
            pageContextUsed = true;
          }
        }
      }
      const dateOwner = entries.find((entry) => plannedSources.includes(entry.id) && entry.fields.some((field) => field.role === 'date'));
      const dateKey = dateOwner?.fields.find((field) => field.role === 'date')?.key ?? null;
      const dated = [];
      const recentField = dateField(entries.filter(entry => plannedSources.includes(entry.id)));
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
      // A previous condition whose field the request names again is replaced, unless the request
      // adds to it. A condition the request does not name is kept, unless the request drops it.
      // Decided after the period filter, so a new period replaces the previous one.
      const named = new Set([...selected, ...dated].map((filter) => `${filter.source}\u0000${filter.field}`));
      const carried = previousFilters.flatMap((filter, index) => {
        const same = named.has(`${filter.source}\u0000${filter.field}`);
        const decision = same
          ? chosen(answers[`add_${index}`], ['true', 'false']) === 'true'
          : chosen(answers[`drop_${index}`], ['true', 'false']) !== 'true';
        return decision ? [{ source: filter.source, field: filter.field, op: filter.op, values: [...filter.values] }] : [];
      });
      const pageFields = new Set(pageFilters.map((filter) => `${filter.source}\u0000${filter.field}`));
      // Shared facet values can be selected in several sources; only the chosen scope applies.
      const filters = mergeFilters([
        ...[...carried, ...selected, ...dated].filter((filter) => plannedSources.includes(filter.source) && !pageFields.has(`${filter.source}\u0000${filter.field}`)),
        ...pageFilters,
      ]);
      const judged = contentChoice === 'true' ? true : contentChoice === 'false' ? false : null;
      // A follow-up that does not restate its content keeps the previous content condition,
      // for example "そのうち三島工場資材課の" after "錆の不適合".
      const carriedQuery = contentCarry === 'same' ? previousQuery : '';
      const previousSpan = carriedQuery && typeof previousPlan?.contentSpan === 'string' ? previousPlan.contentSpan : null;
      const jev = judged;
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
        }, catalog) ? '' : (carriedQuery || question.trim()),
        sort,
        limit: limitExplicit ? Number(limitChoice) : 5,
        display: entries.flatMap((entry) => entry.fields.map((field) => field.key)),
        unresolved: outOfScope ? [] : unresolved,
        diagnostics: {
          contentDecision: { jev, residualTokens: [], final: finalContent },
          scope: outOfScope ? 'out_of_scope' : 'records',
          limitExplicit,
          ...(carriedQuery ? (previousSpan ? { contentSpan: previousSpan } : {}) : (contentSpan ? { contentSpan } : {})),
          ...(excludeShown ? { excludeShown: true } : {}),
        },
      };
      return {
        plan,
        timings: { planMs },
        receipt: {
          ...(pageContext ? { pageContext: { used: pageContextUsed, kind: pageContext.entity.kind, value: pageContext.entity.value } } : {}),
          model: typeof evaluated?.model === 'string' ? evaluated.model : null,
          questionVersion: PLANNER_QUESTION_VERSION,
          turn: hasPrevious ? 'followup' : 'first',
          answers: summarizeAnswers(questions, answers),
          fields: Object.fromEntries([...optionMap].map(([key, mapped]) => [key, mapped.group.field ?? mapped.group.term ?? null])),
        },
      };
    },
  };
}

function scopeChoiceOf(answer, sourceIds) {
  const probabilities = answer?.probabilities;
  if (probabilities && typeof probabilities === 'object') {
    let best = null;
    let bestScore = -1;
    for (const id of sourceIds) {
      const score = Number(probabilities[id]);
      if (Number.isFinite(score) && score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    const outside = Number(probabilities[OUT_OF_SCOPE]);
    const floor = bestScore < 0 ? 0 : bestScore;
    if (Number.isFinite(outside) && outside >= floor + OUT_OF_SCOPE_MARGIN) return OUT_OF_SCOPE;
    return best ?? sourceIds[0];
  }
  const pick = chosen(answer, [...sourceIds, OUT_OF_SCOPE]);
  return pick === OUT_OF_SCOPE ? OUT_OF_SCOPE : (pick ?? sourceIds[0]);
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
