import { catalogEntries } from './catalog.mjs';

const MAX_PARTIAL_CANDIDATES = 8;
const MIN_TERM_LENGTH = 2;

export function normalizeForMatch(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase();
}

function distinctValues(records, key) {
  const seen = new Map();
  for (const record of records) {
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
      byField[field.key] = distinctValues(records, field.key);
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
