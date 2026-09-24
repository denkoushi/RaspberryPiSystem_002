import { catalogEntries } from './catalog.mjs';
import { normalizeForMatch } from './value-index.mjs';

export const QUERY_PLAN_SCHEMA = 'hermes-query-plan/v1';
const OPS = new Set(['eq', 'in', 'not_in', 'before', 'after', 'between']);
const DATE_OPS = new Set(['before', 'after', 'between']);
const SINGLE_VALUE_OPS = new Set(['eq', 'before', 'after']);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function fail(message, candidates = []) {
  return { ok: false, clarification: { message, candidates } };
}

function valueCountError(op, count) {
  if (SINGLE_VALUE_OPS.has(op)) return count === 1 ? null : `${op} expects 1 value`;
  if (op === 'between') return count === 2 ? null : 'between expects 2 values';
  if (op === 'in' || op === 'not_in') return count >= 1 ? null : `${op} expects at least 1 value`;
  return `unknown op: ${op}`;
}

function indexedValues(valueIndex, source, field) {
  return valueIndex?.values?.[source]?.[field] ?? [];
}

function canonicalValue(valueIndex, source, field, value) {
  const norm = normalizeForMatch(value);
  return indexedValues(valueIndex, source, field).find((item) => normalizeForMatch(item) === norm) ?? value;
}

function suggestionCandidates(valueIndex, source, field) {
  const values = indexedValues(valueIndex, source, field);
  return values.length > 0 && values.length <= 8 ? [...values] : [];
}

export function validateQueryPlan(plan, catalog, valueIndex) {
  let entries;
  try {
    entries = catalogEntries(catalog);
  } catch (error) {
    return fail(error.message);
  }
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return fail('query plan must be an object');
  if (plan.schema !== QUERY_PLAN_SCHEMA) return fail(`schema must be ${QUERY_PLAN_SCHEMA}`);
  if (!Array.isArray(plan.sources) || !plan.sources.length || plan.sources.some((source) => typeof source !== 'string' || !source)) {
    return fail('sources must be a non-empty list of source ids');
  }
  for (const source of plan.sources) {
    if (!byId.has(source)) return fail(`unknown source: ${source}`);
  }
  if (!Array.isArray(plan.filters)) return fail('filters must be an array');

  const filters = [];
  for (const filter of plan.filters) {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return fail('filter must be an object');
    if (typeof filter.source !== 'string' || !byId.has(filter.source) || !plan.sources.includes(filter.source)) {
      return fail(`unknown source: ${String(filter.source)}`);
    }
    const field = byId.get(filter.source).fields.find((item) => item.key === filter.field);
    if (!field) return fail(`unknown field: ${String(filter.field)}`);
    if (!field.filterable) return fail(`field is not filterable: ${field.key}`);
    if (!OPS.has(filter.op)) return fail(`unknown op: ${String(filter.op)}`);
    if (!Array.isArray(filter.values) || filter.values.some((value) => typeof value !== 'string' || !value.trim())) {
      return fail('filter values must be non-empty strings');
    }
    const countError = valueCountError(filter.op, filter.values.length);
    if (countError) return fail(countError);
    if (DATE_OPS.has(filter.op) && field.role !== 'date') return fail(`${filter.op} requires a date field`);
    const values = [];
    for (const value of filter.values) {
      if (field.enumerated) {
        const known = indexedValues(valueIndex, filter.source, field.key).some((item) => normalizeForMatch(item) === normalizeForMatch(value));
        if (!known) {
          return fail(`value is not in the index: ${field.key}`, [{
            term: value,
            candidates: suggestionCandidates(valueIndex, filter.source, field.key),
          }]);
        }
        values.push(canonicalValue(valueIndex, filter.source, field.key, value));
      } else {
        values.push(value);
      }
    }
    filters.push({ source: filter.source, field: field.key, op: filter.op, values });
  }

  if (typeof plan.semanticQuery !== 'string') return fail('semanticQuery must be a string');
  if (plan.sort !== 'relevance') {
    if (!plan.sort || typeof plan.sort !== 'object' || Array.isArray(plan.sort)) {
      return fail('sort must be relevance or {field, direction}');
    }
    if (plan.sort.direction !== 'asc' && plan.sort.direction !== 'desc') return fail('sort direction must be asc or desc');
    const known = plan.sources.some((source) => byId.get(source).fields.some((field) => field.key === plan.sort.field));
    if (!known) return fail(`unknown sort field: ${String(plan.sort.field)}`);
  }
  if (!Number.isInteger(plan.limit) || plan.limit < 1 || plan.limit > 20) return fail('limit must be an integer from 1 to 20');
  if (!Array.isArray(plan.display) || plan.display.some((key) => typeof key !== 'string' || !key)) {
    return fail('display must be a list of field keys');
  }
  for (const key of plan.display) {
    const known = plan.sources.some((source) => byId.get(source).fields.some((field) => field.key === key));
    if (!known) return fail(`unknown display field: ${key}`);
  }
  if (!Array.isArray(plan.unresolved)) return fail('unresolved must be an array');
  for (const item of plan.unresolved) {
    if (!item || typeof item.term !== 'string' || !Array.isArray(item.candidates) || item.candidates.some((candidate) => typeof candidate !== 'string')) {
      return fail('unresolved items must have term and candidates');
    }
  }
  if (plan.unresolved.length) {
    return fail('Some terms could not be resolved to an indexed value.', plan.unresolved.map((item) => ({
      term: item.term,
      candidates: [...item.candidates],
    })));
  }

  const sort = plan.sort === 'relevance'
    ? 'relevance'
    : { field: plan.sort.field, direction: plan.sort.direction };
  const contentDecision = copyContentDecision(plan);
  return {
    ok: true,
    plan: freeze({
      schema: QUERY_PLAN_SCHEMA,
      sources: [...plan.sources],
      filters,
      semanticQuery: plan.semanticQuery,
      sort,
      limit: plan.limit,
      display: [...plan.display],
      unresolved: [],
      ...(contentDecision ? { diagnostics: { contentDecision } } : {}),
    }),
  };
}

function copyContentDecision(plan) {
  const decision = plan?.diagnostics?.contentDecision;
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return null;
  const residualTokens = Array.isArray(decision.residualTokens)
    ? decision.residualTokens.filter((token) => typeof token === 'string')
    : [];
  return {
    jev: decision.jev === true ? true : decision.jev === false ? false : null,
    residualTokens,
    final: decision.final === true,
  };
}
