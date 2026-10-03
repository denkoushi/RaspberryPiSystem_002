// Contrastive record pairs for synthetic questions. Record A anchors the question; record B is
// the most similar record that A's question must not match. Similarity comes from the stored
// record embeddings (retrieval-dense-dgx.bin), so no new embedding work is needed.
import { INTENTS } from './flywheel-seeds.mjs';

// Above this cosine two records are near copies (the same report filed twice), which makes a
// question that separates them impossible.
export const PAIR_MAX_SIMILARITY = 0.97;
// Below this the second record is not a useful near miss.
export const PAIR_MIN_SIMILARITY = 0.5;
// Two reports of the same event on sister machines share most of their wording; no question can
// separate them, so a candidate B whose body shares more than this share of character bigrams
// (Jaccard) with A's body is skipped. A sample of 100 real pairs on 2026-10-03 had such a pair.
export const PAIR_MAX_TEXT_OVERLAP = 0.5;

function bigramSet(value) {
  const textValue = String(value ?? '').normalize('NFKC').replace(/\s+/gu, '');
  const grams = new Set();
  for (let index = 0; index + 1 < textValue.length; index += 1) grams.add(textValue.slice(index, index + 2));
  return grams;
}

export function textOverlap(left, right) {
  const a = bigramSet(left);
  const b = bigramSet(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function bareId(id) {
  return String(id ?? '').replace(/^[a-z_]+:/u, '');
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function bodyText(record) {
  return ['condition', 'remarks', 'correctiveContent', 'disposition'].map((key) => text(record?.[key])).filter(Boolean).join('\n');
}

/** Intents record can answer: at least one of the intent's fields has text. */
export function answerableIntents(record) {
  return INTENTS.filter((intent) => intent.fields.some((key) => text(record?.[key]))).map((intent) => intent.id);
}

function cosine(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
}

function sharesContext(a, b) {
  const same = (key) => text(a?.[key]) && text(a?.[key]) === text(b?.[key]);
  return same('originDepartmentName') || same('partName') || same('machineName');
}

/**
 * `count` pairs. A is drawn at random among records with body text and a stored vector. B is the
 * nearest record by cosine that shares A's department, part name, or machine, has different body
 * text that does not overlap more than PAIR_MAX_TEXT_OVERLAP, and lies between PAIR_MIN_SIMILARITY
 * and PAIR_MAX_SIMILARITY. A record is used as A at most once. `exclude` holds A ids already
 * used on earlier nights.
 */
export function samplePairs({ records, denseEntries, count, random, exclude = new Set(), maxTries = count * 20 }) {
  const vectors = new Map((denseEntries ?? []).map((entry) => [bareId(entry.id), entry.vector]));
  const pool = (records ?? []).filter((record) => bodyText(record) && vectors.has(bareId(record.id)));
  const pairs = [];
  const used = new Set(exclude);
  for (let tries = 0; pairs.length < count && tries < maxTries && pool.length > 1; tries += 1) {
    const a = pool[Math.floor(random() * pool.length)];
    const aId = bareId(a.id);
    if (used.has(aId)) continue;
    used.add(aId);
    const aVector = vectors.get(aId);
    const aBody = bodyText(a);
    let best = null;
    for (const b of pool) {
      const bId = bareId(b.id);
      if (bId === aId || !sharesContext(a, b) || bodyText(b) === aBody) continue;
      const similarity = cosine(aVector, vectors.get(bId));
      if (similarity > PAIR_MAX_SIMILARITY || similarity < PAIR_MIN_SIMILARITY) continue;
      if (best && similarity <= best.similarity) continue;
      if (textOverlap(aBody, bodyText(b)) > PAIR_MAX_TEXT_OVERLAP) continue;
      best = { b, similarity };
    }
    if (!best) continue;
    pairs.push({ a: aId, b: bareId(best.b.id), similarity: Math.round(best.similarity * 1000) / 1000 });
  }
  return pairs;
}
