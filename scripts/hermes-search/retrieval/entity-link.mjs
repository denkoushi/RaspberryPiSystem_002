// Dense entity linking for enumerated catalog values.
// Normalization is generic (NFKC, parenthesis drop, hierarchy suffix strip).
// DGX pre-tags would enter at the same place as `links`: a list of
// { source, field, values, decision } applied before the planner confirms.
import { catalogEntries } from './catalog.mjs';
import { contentTokens } from './structural-text.mjs';

export const LINK_MIN_SCORE = 0.82;
export const LINK_MARGIN = 0.03;
export const LINK_MAX_IN = 8;
const HIERARCHY_MARKERS = ['工場', '部'];

export function cosine(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function valueForms(value) {
  const text = String(value ?? '').normalize('NFKC').trim();
  const forms = new Set();
  const add = (raw) => {
    const folded = String(raw ?? '').normalize('NFKC').replace(/\s+/gu, '').trim();
    if (folded.length >= 2) forms.add(folded);
  };
  add(text);
  const withoutParens = text.replace(/（[^）]*）|\([^)]*\)/gu, '');
  add(withoutParens);
  let stripped = withoutParens;
  for (const marker of HIERARCHY_MARKERS) stripped = stripped.split(marker).join('');
  add(stripped);
  const factory = withoutParens.match(/(.+?)工場/u);
  if (factory) add(factory[1]);
  const section = withoutParens.match(/([^工場部]+課)$/u);
  if (section) add(section[1]);
  return [...forms];
}

export function querySpans(question) {
  const spans = new Set();
  const whole = String(question ?? '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
  if (whole.length >= 2) spans.add(whole);
  for (const token of contentTokens(question)) {
    if (token.length >= 2) spans.add(token);
  }
  return [...spans];
}

function bestScore(spanVectors, formVector) {
  let best = 0;
  for (const span of spanVectors) {
    const score = cosine(span, formVector);
    if (score > best) best = score;
  }
  return best;
}

/**
 * @param {Array<{value: string, form: string, score: number}>} hits
 */
export function decideLink(hits, { minScore = LINK_MIN_SCORE, margin = LINK_MARGIN, maxIn = LINK_MAX_IN } = {}) {
  const byValue = new Map();
  for (const hit of hits) {
    if (!hit || typeof hit.value !== 'string' || !(hit.score >= minScore)) continue;
    const row = byValue.get(hit.value) ?? [];
    row.push(hit);
    byValue.set(hit.value, row);
  }
  if (!byValue.size) return { decision: 'none', values: [] };
  const formOwners = new Map();
  for (const [value, rows] of byValue) {
    for (const row of rows) {
      const owners = formOwners.get(row.form) ?? new Set();
      owners.add(value);
      formOwners.set(row.form, owners);
    }
  }
  const ranked = [...byValue.entries()].map(([value, rows]) => {
    let unique = 0;
    let shared = 0;
    for (const row of rows) {
      const owners = formOwners.get(row.form);
      if (owners && owners.size === 1) unique = Math.max(unique, row.score);
      else shared = Math.max(shared, row.score);
    }
    return { value, unique, shared, score: Math.max(unique, shared) };
  }).sort((left, right) => right.score - left.score || left.value.localeCompare(right.value, 'ja'));
  const best = ranked[0];
  const uniqueLeaders = ranked.filter((row) => row.unique >= minScore && row.unique + margin >= best.score);
  if (uniqueLeaders.length === 1) {
    return { decision: 'eq', values: [uniqueLeaders[0].value] };
  }
  if (uniqueLeaders.length > 1) {
    const values = uniqueLeaders.map((row) => row.value);
    return values.length > maxIn
      ? { decision: 'clarify', values }
      : { decision: 'in', values };
  }
  const close = ranked.filter((row) => row.score >= best.score - margin);
  const values = close.map((row) => row.value);
  if (values.length > maxIn) return { decision: 'clarify', values };
  if (values.length > 1) return { decision: 'in', values };
  return { decision: 'eq', values };
}

export function linkableFields(catalog) {
  const fields = [];
  for (const entry of catalogEntries(catalog)) {
    for (const field of entry.fields) {
      if (!field.filterable || !field.enumerated) continue;
      if (field.role === 'identifier') continue;
      fields.push({ source: entry.id, field: field.key });
    }
  }
  return fields;
}

export async function linkEntities({ question, valueIndex, catalog, embed, minScore, margin, maxIn }) {
  const spans = querySpans(question);
  if (!spans.length || typeof embed !== 'function') return [];
  const fields = linkableFields(catalog);
  const formRows = [];
  for (const { source, field } of fields) {
    const values = valueIndex?.values?.[source]?.[field] ?? [];
    for (const value of values) {
      for (const form of valueForms(value)) formRows.push({ source, field, value, form });
    }
  }
  if (!formRows.length) return [];
  const texts = [...new Set([...spans, ...formRows.map((row) => row.form)])];
  const vectors = await embed(texts);
  const vectorOf = new Map(texts.map((text, index) => [text, vectors[index]]));
  const spanVectors = spans.map((span) => vectorOf.get(span)).filter(Boolean);
  const groups = [];
  for (const { source, field } of fields) {
    const hits = formRows
      .filter((row) => row.source === source && row.field === field)
      .map((row) => ({
        value: row.value,
        form: row.form,
        score: bestScore(spanVectors, vectorOf.get(row.form) ?? []),
      }));
    const decided = decideLink(hits, { minScore, margin, maxIn });
    if (decided.decision === 'none') continue;
    groups.push({
      source,
      field,
      term: field,
      values: decided.values,
      decision: decided.decision,
    });
  }
  return groups;
}
