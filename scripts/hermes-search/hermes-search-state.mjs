import { createHash } from 'node:crypto';

export const SEARCH_STATE_SCHEMA = 'hermes-search-state/v1';

const ACTIONS = new Set(['new_search', 'add_condition', 'replace_condition', 'remove_condition', 'correct_condition']);
const EXACT_FIELDS = new Set([
  'nonconformityNo', 'partNumber', 'partName', 'machineName', 'originDepartmentCode', 'discoveredOn'
]);
const DISPLAY_FIELDS = new Set(['originalText', 'discoveredOn', 'process', 'phenomenon', 'treatment', 'cause', 'identifiers']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeObject(value) {
  return isObject(value) ? value : {};
}

function normalizeConditionMap(value) {
  const source = normalizeObject(value);
  const result = {};
  for (const [field, expected] of Object.entries(source)) {
    if (expected === undefined || expected === null || expected === '') continue;
    if (Array.isArray(expected)) {
      const values = expected.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
      if (values.length) result[field] = unique(values);
    } else if (typeof expected === 'string' && expected.trim()) {
      result[field] = expected.trim();
    }
  }
  return result;
}

function normalizeOrganization(value) {
  const source = normalizeObject(value);
  const normalizeValues = (items) => (Array.isArray(items) ? items : [])
    .filter((item) => isObject(item) && typeof item.name === 'string' && item.name.trim())
    .map((item) => ({
      name: item.name.trim(),
      code: typeof item.code === 'string' && item.code.trim() ? item.code.trim() : null,
    }));
  return {
    include: normalizeValues(source.include),
    exclude: normalizeValues(source.exclude),
    matchedTerms: unique((Array.isArray(source.matchedTerms) ? source.matchedTerms : [])
      .filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())),
    status: source.status === 'unresolved' ? 'unresolved' : 'resolved',
  };
}

function normalizeDisplay(value) {
  const source = normalizeObject(value);
  return {
    originalText: source.originalText !== false,
    requested: unique((Array.isArray(source.requested) ? source.requested : [])
      .filter((item) => DISPLAY_FIELDS.has(item))),
  };
}

function normalizeUnresolved(value) {
  return (Array.isArray(value) ? value : []).map((item) => {
    if (!isObject(item)) return null;
    return {
      kind: typeof item.kind === 'string' ? item.kind : 'condition',
      field: typeof item.field === 'string' ? item.field : null,
      term: typeof item.term === 'string' ? item.term : null,
      reason: typeof item.reason === 'string' ? item.reason : 'unresolved',
    };
  }).filter(Boolean);
}

export function emptySearchState() {
  return {
    schema: SEARCH_STATE_SCHEMA,
    revision: 0,
    sources: ['nonconformity'],
    exact: {
      include: {},
      exclude: {},
      organization: { include: [], exclude: [], matchedTerms: [], status: 'resolved' },
    },
    semantic: { include: {}, exclude: {} },
    sort: null,
    limit: 20,
    display: { originalText: true, requested: [] },
    unresolvedConditions: [],
    lastAction: null,
  };
}

function normalizeState(value) {
  const source = isObject(value) ? value : {};
  const base = emptySearchState();
  const exact = normalizeObject(source.exact);
  const semantic = normalizeObject(source.semantic);
  const sort = isObject(source.sort) && typeof source.sort.field === 'string'
    ? { field: source.sort.field, direction: source.sort.direction === 'asc' ? 'asc' : 'desc' }
    : null;
  return {
    ...base,
    schema: SEARCH_STATE_SCHEMA,
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    sources: unique((Array.isArray(source.sources) ? source.sources : base.sources)
      .filter((item) => item === 'nonconformity')),
    exact: {
      include: normalizeConditionMap(exact.include),
      exclude: normalizeConditionMap(exact.exclude),
      organization: normalizeOrganization(exact.organization),
    },
    semantic: {
      include: normalizeConditionMap(semantic.include),
      exclude: normalizeConditionMap(semantic.exclude),
    },
    sort,
    limit: Number.isSafeInteger(source.limit) && source.limit >= 1 && source.limit <= 20 ? source.limit : 20,
    display: normalizeDisplay(source.display),
    unresolvedConditions: normalizeUnresolved(source.unresolvedConditions),
    lastAction: ACTIONS.has(source.lastAction) ? source.lastAction : null,
  };
}

export function validateSearchState(value) {
  if (!isObject(value) || value.schema !== SEARCH_STATE_SCHEMA) throw new Error('invalid SearchState schema');
  const normalized = normalizeState(value);
  if (normalized.sources.length !== 1 || normalized.sources[0] !== 'nonconformity') throw new Error('unsupported SearchState source');
  if (normalized.revision !== value.revision || normalized.limit !== value.limit) throw new Error('invalid SearchState scalar');
  return normalized;
}

export function validateSearchDelta(value) {
  if (!isObject(value) || !ACTIONS.has(value.action)) throw new Error('invalid SearchDelta action');
  if (value.sources && (!Array.isArray(value.sources) || value.sources.some((source) => source !== 'nonconformity'))) {
    throw new Error('unsupported SearchDelta source');
  }
  if (value.limit !== undefined && (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 20)) {
    throw new Error('invalid SearchDelta limit');
  }
  if (value.sort !== undefined && value.sort !== null && (!isObject(value.sort) || typeof value.sort.field !== 'string')) {
    throw new Error('invalid SearchDelta sort');
  }
  return {
    action: value.action,
    sources: value.sources ? ['nonconformity'] : undefined,
    exact: isObject(value.exact) ? {
      include: normalizeConditionMap(value.exact.include),
      exclude: normalizeConditionMap(value.exact.exclude),
      ...(value.exact.organization ? { organization: normalizeOrganization(value.exact.organization) } : {}),
    } : undefined,
    semantic: isObject(value.semantic) ? {
      include: normalizeConditionMap(value.semantic.include),
      exclude: normalizeConditionMap(value.semantic.exclude),
    } : undefined,
    remove: isObject(value.remove) ? { ...value.remove } : undefined,
    sort: value.sort === null ? null : value.sort ? { field: value.sort.field, direction: value.sort.direction === 'asc' ? 'asc' : 'desc' } : undefined,
    limit: value.limit,
    display: value.display === undefined ? undefined : normalizeDisplay(value.display),
    unresolvedConditions: normalizeUnresolved(value.unresolvedConditions),
  };
}

function mergeMaps(current, incoming) {
  const result = { ...current };
  for (const [field, value] of Object.entries(incoming ?? {})) {
    if (Array.isArray(value) && Array.isArray(result[field])) result[field] = unique([...result[field], ...value]);
    else result[field] = clone(value);
  }
  return result;
}

function replaceMaps(current, incoming) {
  return incoming ? clone(incoming) : current;
}

function removeMapFields(map, fields) {
  const result = { ...map };
  for (const field of fields) delete result[field];
  return result;
}

export function applySearchDelta(previous, rawDelta) {
  const current = validateSearchState(previous ?? emptySearchState());
  const delta = validateSearchDelta(rawDelta);
  let next = delta.action === 'new_search' ? emptySearchState() : clone(current);
  if (delta.exact) {
    if (delta.action === 'add_condition' || delta.action === 'correct_condition') {
      next.exact.include = mergeMaps(next.exact.include, delta.exact.include);
      next.exact.exclude = mergeMaps(next.exact.exclude, delta.exact.exclude);
      if (delta.exact.organization?.include.length || delta.exact.organization?.exclude.length) {
        next.exact.organization = {
          ...next.exact.organization,
          include: [...next.exact.organization.include, ...delta.exact.organization.include],
          exclude: [...next.exact.organization.exclude, ...delta.exact.organization.exclude],
          matchedTerms: unique([...next.exact.organization.matchedTerms, ...delta.exact.organization.matchedTerms]),
          status: delta.exact.organization.status,
        };
      }
    } else if (delta.action !== 'remove_condition') {
      if (Object.keys(delta.exact.include).length) next.exact.include = replaceMaps(next.exact.include, delta.exact.include);
      if (Object.keys(delta.exact.exclude).length) next.exact.exclude = replaceMaps(next.exact.exclude, delta.exact.exclude);
      if (delta.exact.organization) next.exact.organization = delta.exact.organization;
    }
  }
  if (delta.semantic && delta.action !== 'remove_condition') {
    if (delta.action === 'add_condition' || delta.action === 'correct_condition') {
      next.semantic.include = mergeMaps(next.semantic.include, delta.semantic.include);
      next.semantic.exclude = mergeMaps(next.semantic.exclude, delta.semantic.exclude);
    } else if (delta.action === 'new_search' || Object.keys(delta.semantic.include).length || Object.keys(delta.semantic.exclude).length) {
      next.semantic.include = replaceMaps(next.semantic.include, delta.semantic.include);
      next.semantic.exclude = replaceMaps(next.semantic.exclude, delta.semantic.exclude);
    }
  }
  if (delta.action === 'remove_condition') {
    const remove = delta.remove ?? {};
    if (remove.organization) next.exact.organization = emptySearchState().exact.organization;
    if (Array.isArray(remove.exactFields)) {
      next.exact.include = removeMapFields(next.exact.include, remove.exactFields);
      next.exact.exclude = removeMapFields(next.exact.exclude, remove.exactFields);
    }
    if (Array.isArray(remove.semanticFields)) {
      next.semantic.include = removeMapFields(next.semantic.include, remove.semanticFields);
      next.semantic.exclude = removeMapFields(next.semantic.exclude, remove.semanticFields);
    }
    if (remove.sort) next.sort = null;
    if (remove.limit) next.limit = 20;
    if (remove.display) next.display = emptySearchState().display;
  }
  if (delta.sort !== undefined) next.sort = delta.sort;
  if (delta.limit !== undefined) next.limit = delta.limit;
  if (delta.display !== undefined) next.display = delta.display;
  next.unresolvedConditions = delta.unresolvedConditions;
  next.lastAction = delta.action;
  next.revision = current.revision + 1;
  return validateSearchState(next);
}

export function hasSemanticConditions(state) {
  const value = validateSearchState(state);
  return Object.keys(value.semantic.include).length > 0 || Object.keys(value.semantic.exclude).length > 0;
}

export function stateFingerprint(state) {
  const value = JSON.stringify(validateSearchState(state));
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function deltaFingerprint(delta) {
  const value = JSON.stringify(validateSearchDelta(delta));
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function searchStateSummary(state) {
  const value = validateSearchState(state);
  return {
    revision: value.revision,
    sources: value.sources,
    exactFieldCount: Object.keys(value.exact.include).length + Object.keys(value.exact.exclude).length,
    organizationIncludeCount: value.exact.organization.include.length,
    semanticFieldCount: Object.keys(value.semantic.include).length + Object.keys(value.semantic.exclude).length,
    hasSort: Boolean(value.sort),
    limit: value.limit,
    unresolvedCount: value.unresolvedConditions.length,
  };
}

export function exactSearchArguments(state) {
  const value = validateSearchState(state);
  if (hasSemanticConditions(value) || value.exact.organization.exclude.length || Object.keys(value.exact.exclude).length) return null;
  if (Object.keys(value.exact.include).length === 0 && value.exact.organization.include.length === 0) return null;
  const args = { kind: 'nonconformity', limit: value.limit };
  for (const [field, expected] of Object.entries(value.exact.include)) {
    if (!EXACT_FIELDS.has(field)) return null;
    if (field === 'discoveredOn') {
      args.dateFrom = expected;
      args.dateTo = expected;
    } else args[field] = expected;
  }
  const organizationTerm = value.exact.organization.matchedTerms[0];
  if (organizationTerm) args.originDepartmentName = organizationTerm;
  return args;
}
