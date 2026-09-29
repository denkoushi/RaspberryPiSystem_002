import { readFileSync } from 'node:fs';
import { periodSpans } from './period-parse.mjs';

const raw = JSON.parse(readFileSync(new URL('./query-structural-words.json', import.meta.url), 'utf8'));
const rawWords = raw?.words;
const rawParticles = raw?.particles;
if (!Array.isArray(rawWords) || rawWords.some((word) => typeof word !== 'string' || !word)) {
  throw new Error('structural words must be a list of strings');
}
if (!Array.isArray(rawParticles) || rawParticles.some((word) => typeof word !== 'string' || !word)) {
  throw new Error('structural particles must be a list of strings');
}

export const structuralWords = Object.freeze([...rawWords].sort((left, right) => right.length - left.length));
const sourceLabels = JSON.parse(readFileSync(new URL('./source-labels.json', import.meta.url), 'utf8'));
// Source names such as 不適合 appear in every record of that source, so they never narrow a search.
export const sourceLabelWords = Object.freeze(Object.values(sourceLabels).filter((label) => typeof label === 'string' && label));
export const functionParticles = Object.freeze([...rawParticles].sort((left, right) => right.length - left.length));

const COUNT_EXPRESSION = /[0-9０-９]+件|[〇零一二三四五六七八九十百千万]+件/gu;

export function stripListedTerms(text, terms) {
  let result = String(text ?? '').normalize('NFKC');
  const ordered = [...terms].filter((term) => typeof term === 'string' && term).sort((left, right) => right.length - left.length);
  for (const term of ordered) {
    const escaped = term.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    result = result.replace(new RegExp(escaped, 'giu'), ' ');
  }
  return result;
}

function consumeParticle(text) {
  return functionParticles.find((particle) => text.startsWith(particle)) ?? null;
}

export function isParticleFragment(text) {
  let rest = String(text ?? '').normalize('NFKC');
  if (!rest) return true;
  while (rest) {
    const particle = consumeParticle(rest);
    if (!particle) return false;
    rest = rest.slice(particle.length);
  }
  return true;
}

function trimParticleEdges(fragment) {
  let rest = fragment;
  let changed = true;
  while (rest && changed) {
    changed = false;
    const leading = consumeParticle(rest);
    if (leading && leading.length < rest.length) {
      rest = rest.slice(leading.length);
      changed = true;
    }
    for (const particle of functionParticles) {
      if (rest.endsWith(particle) && particle.length < rest.length) {
        rest = rest.slice(0, -particle.length);
        changed = true;
        break;
      }
    }
  }
  return rest;
}

const TOKEN_GAP = /[のはがをにへでとやも\s]+/u;
const SINGLE_KANJI = /^\p{Script=Han}$/u;
const SINGLE_KATAKANA = /^\p{Script=Katakana}$/u;

export function contentTokens(text) {
  const stripped = contentQuery(text);
  if (!stripped) return [];
  return stripped.split(TOKEN_GAP)
    .map((token) => token.normalize('NFKC').toLowerCase())
    .filter((token) => token.length >= 2 || SINGLE_KANJI.test(token) || SINGLE_KATAKANA.test(token));
}

function stripPeriodText(text) {
  const source = String(text ?? '').normalize('NFKC');
  const spans = periodSpans(source).sort((left, right) => right.start - left.start);
  let result = source;
  for (const span of spans) result = `${result.slice(0, span.start)} ${result.slice(span.end)}`;
  return result;
}

export function contentQuery(text) {
  let result = stripListedTerms(stripPeriodText(text), structuralWords).replace(COUNT_EXPRESSION, ' ');
  const kept = [];
  for (const fragment of result.split(/\s+/u)) {
    if (!fragment) continue;
    const trimmed = trimParticleEdges(fragment.normalize('NFKC'));
    if (!trimmed || isParticleFragment(trimmed)) continue;
    kept.push(trimmed);
  }
  return kept.join(' ');
}

// The relevance judge sees only the content condition. Counts, period words, structural words, and
// source names are applied by the plan; a judge that sees 「の不適合３件」 rejects records that match.
// A source name is dropped only as a word of its own (「塗装不良の不適合」), not inside a compound
// such as 「寸法不適合」, which still names the condition.
const STANDALONE_EDGE = '[\\sのはがをにへでとやも]';

function stripStandaloneLabels(text) {
  let result = String(text ?? '').normalize('NFKC');
  for (const label of sourceLabelWords) {
    const escaped = label.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    result = result.replace(new RegExp(`(^|${STANDALONE_EDGE})${escaped}(?=$|${STANDALONE_EDGE}|[0-9０-９〇零一二三四五六七八九十百千万])`, 'gu'), '$1 ');
  }
  return result;
}

const QUERY_PUNCTUATION = /[?？!！。、,，.．・「」『』()（）]/gu;

// Returns '' when nothing but structure, the source name, or applied filter values is left; the caller
// then skips the judge, because organization and dates are not judged and nothing else remains.
// A written filter value is often shorter than the stored one (三島工場組立課 for
// 三島工場製造部組立課（製造）), so a token counts as the filter when most of its character pairs occur in it.
const FILTER_OVERLAP_MIN = 0.6;

function isFilterToken(token, filterValues) {
  const folded = token.normalize('NFKC').toLowerCase();
  const pairs = [];
  for (let index = 0; index < folded.length - 1; index += 1) pairs.push(folded.slice(index, index + 2));
  if (!pairs.length) return false;
  return filterValues.some((value) => {
    const target = String(value ?? '').normalize('NFKC').toLowerCase();
    return target && pairs.filter((pair) => target.includes(pair)).length / pairs.length >= FILTER_OVERLAP_MIN;
  });
}

export function relevanceQuery(text, filterValues = []) {
  const query = contentQuery(stripStandaloneLabels(text).replace(QUERY_PUNCTUATION, ' '));
  if (!query || !filterValues.length) return query;
  const tokens = query.split(TOKEN_GAP).filter(Boolean);
  const kept = tokens.filter((token) => !isFilterToken(token, filterValues));
  return kept.length === tokens.length ? query : kept.join(' ');
}

// Candidate parts of a question for the planner to pick the content condition from. The question is
// cut only at grammar: the topic particle は, which usually separates the content from the request
// (「…件はありますか」, 「…案件はほかにある」), and punctuation. が and も are not cut, because they
// sit inside a condition such as 「割れが出た」. No phrase such as ほかに is listed; JEV picks the part,
// and the whole question is always one of the choices.
const CLAUSE_BREAK = /[\s、，,。？?！!は]+/u;
const SPAN_PUNCTUATION = /[、，,。？?！!]/gu;
export const MAX_CONTENT_SPANS = 5;

export function contentSpans(text) {
  const whole = contentQuery(String(text ?? '').normalize('NFKC').replace(SPAN_PUNCTUATION, ' ')).trim();
  if (!whole) return [];
  const clauses = [];
  for (const piece of whole.split(CLAUSE_BREAK)) {
    const trimmed = trimParticleEdges(piece.normalize('NFKC'));
    if (trimmed.length < 2 || isParticleFragment(trimmed) || clauses.includes(trimmed)) continue;
    clauses.push(trimmed);
  }
  if (clauses.length < 2) return [];
  return [...clauses.slice(0, MAX_CONTENT_SPANS), whole];
}
