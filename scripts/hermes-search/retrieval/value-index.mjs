import { recordSourceId } from '../hermes-source-definition.mjs';
import { catalogEntries } from './catalog.mjs';
import { contentTokens } from './structural-text.mjs';

const MAX_PARTIAL_CANDIDATES = 8;
const MIN_TERM_LENGTH = 2;

export function normalizeForMatch(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase();
}

function distinctValues(records, key, sourceId) {
  const seen = new Map();
  for (const record of records) {
    if ((recordSourceId(record)) !== sourceId) continue;
    const raw = record?.[key];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const norm = normalizeForMatch(raw);
    if (!norm || seen.has(norm)) continue;
    seen.set(norm, raw);
  }
  return [...seen.values()].sort((left, right) => left.localeCompare(right, 'ja'));
}

export function buildValueIndex(records, catalog) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  const values = {};
  for (const entry of catalogEntries(catalog)) {
    const byField = {};
    for (const field of entry.fields) {
      if (!field.filterable || !field.enumerated) continue;
      byField[field.key] = distinctValues(records, field.key, entry.id);
    }
    values[entry.id] = byField;
  }
  return { values };
}

function pushGroup(groups, group) {
  const signature = `${group.source}\0${group.field}\0${group.term}`;
  if (groups.some((existing) => `${existing.source}\0${existing.field}\0${existing.term}` === signature)) return;
  groups.push(group);
}

export const VALUE_CHOICE_CAP = 300;
export const VALUE_CHOICE_TOP_K = 20;

function characterBigrams(text) {
  const folded = normalizeForMatch(text).replace(/\s+/gu, '');
  const grams = [];
  for (let index = 0; index < folded.length - 1; index += 1) grams.push(folded.slice(index, index + 2));
  return grams;
}

function valueChoiceCap(entry) {
  return Number.isInteger(entry?.valueChoiceCap) && entry.valueChoiceCap > 0 ? entry.valueChoiceCap : VALUE_CHOICE_CAP;
}

export function choiceValuesForField(question, values, { cap = VALUE_CHOICE_CAP, topK = VALUE_CHOICE_TOP_K } = {}) {
  const list = (values ?? []).filter((value) => typeof value === 'string' && value.trim());
  if (list.length <= cap) return list;
  const queryGrams = characterBigrams(question);
  const documentFrequency = new Map();
  const valueGrams = list.map((value) => {
    const grams = new Set(characterBigrams(value));
    for (const gram of grams) documentFrequency.set(gram, (documentFrequency.get(gram) ?? 0) + 1);
    return grams;
  });
  const total = list.length;
  const scored = list.map((value, index) => {
    let score = 0;
    for (const gram of queryGrams) {
      if (!valueGrams[index].has(gram)) continue;
      const df = documentFrequency.get(gram) ?? 0;
      score += Math.log((total + 1) / (df + 1));
    }
    return { value, score };
  });
  scored.sort((left, right) => right.score - left.score || left.value.localeCompare(right.value, 'ja'));
  const picked = new Set(scored.filter((item) => item.score > 0).slice(0, topK).map((item) => item.value));
  const tokens = contentTokens(typeof question === 'string' ? question : '');
  for (const value of list) {
    const norm = normalizeForMatch(value);
    if (tokens.some((token) => token && norm.includes(normalizeForMatch(token)))) picked.add(value);
  }
  return [...picked];
}

// Organization names are written as one string with the levels run together
// (factory, division, section). A prefix that ends at one of these suffixes and
// covers two or more values is offered as a choice that means every unit beneath it.
export const ORGANIZATION_SUFFIX = /事業所|事業部|本部|工場|センター|グループ|チーム|部|課|室|係/gu;
const MIN_PREFIX_LENGTH = 3;

export function hierarchyGroups(values) {
  const list = (values ?? []).filter((value) => typeof value === 'string' && value.trim());
  const byPrefix = new Map();
  for (const value of list) {
    const folded = value.normalize('NFKC');
    const norm = normalizeForMatch(folded);
    for (const match of folded.matchAll(ORGANIZATION_SUFFIX)) {
      const prefix = folded.slice(0, match.index + match[0].length);
      const prefixNorm = normalizeForMatch(prefix);
      if (prefixNorm.length < MIN_PREFIX_LENGTH || prefixNorm.length >= norm.length) continue;
      if (!byPrefix.has(prefixNorm)) byPrefix.set(prefixNorm, { prefix, values: new Set() });
    }
  }
  for (const value of list) {
    const norm = normalizeForMatch(value);
    for (const [prefixNorm, group] of byPrefix) {
      if (norm.startsWith(prefixNorm)) group.values.add(value);
    }
  }
  return [...byPrefix.values()]
    .filter((group) => group.values.size >= 2)
    .map((group) => ({ prefix: group.prefix, values: [...group.values] }))
    .sort((left, right) => left.prefix.localeCompare(right.prefix, 'ja'));
}

export function enumeratedChoiceGroups(question, valueIndex, catalog) {
  const groups = [];
  for (const entry of catalogEntries(catalog)) {
    const fields = valueIndex?.values?.[entry.id] ?? {};
    for (const field of entry.fields) {
      if (!field.filterable || !field.enumerated) continue;
      const indexed = fields[field.key] ?? [];
      const cap = valueChoiceCap(entry);
      const values = choiceValuesForField(question, indexed, { cap });
      if (!values.length) continue;
      const group = { source: entry.id, field: field.key, values };
      if (field.role === 'organization') {
        const hierarchy = hierarchyGroups(indexed);
        const offered = new Set(choiceValuesForField(question, hierarchy.map((item) => item.prefix), { cap }));
        group.hierarchy = hierarchy.filter((item) => offered.has(item.prefix));
      }
      groups.push(group);
    }
  }
  return groups;
}

export function findCandidateValues(question, valueIndex, catalog) {
  if (typeof question !== 'string') throw new TypeError('question must be a string');
  const surface = question.normalize('NFKC');
  const lowered = surface.toLowerCase();
  const groups = [];
  for (const entry of catalogEntries(catalog)) {
    const fields = valueIndex?.values?.[entry.id] ?? {};
    for (const field of entry.fields) {
      if (!field.filterable || !field.enumerated) continue;
      const values = fields[field.key] ?? [];
      const spans = [];
      const hits = [];
      for (const value of values) {
        const norm = normalizeForMatch(value);
        if (norm.length < MIN_TERM_LENGTH) continue;
        const index = lowered.indexOf(norm);
        if (index < 0) continue;
        hits.push({ value, norm, index });
      }
      hits.sort((left, right) => right.norm.length - left.norm.length || left.index - right.index);
      for (const hit of hits) {
        const end = hit.index + hit.norm.length;
        if (spans.some((span) => hit.index < span.end && end > span.start)) continue;
        spans.push({ start: hit.index, end, value: hit.value, norm: hit.norm });
      }
      for (const span of spans) {
        pushGroup(groups, {
          term: surface.slice(span.start, span.end),
          source: entry.id,
          field: field.key,
          values: [span.value],
        });
      }
      const covered = (start, end) => spans.some((span) => start >= span.start && end <= span.end);
      const tokens = lowered.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
      const seenTokens = new Set();
      for (const token of tokens) {
        if (seenTokens.has(token)) continue;
        seenTokens.add(token);
        const start = lowered.indexOf(token);
        const end = start + token.length;
        if (start < 0 || covered(start, end)) continue;
        const matched = values.filter((value) => {
          const norm = normalizeForMatch(value);
          return norm.length > token.length && norm.includes(token);
        });
        if (!matched.length || matched.length > MAX_PARTIAL_CANDIDATES) continue;
        pushGroup(groups, {
          term: surface.slice(start, end),
          source: entry.id,
          field: field.key,
          values: matched,
        });
      }
    }
  }
  return groups;
}
