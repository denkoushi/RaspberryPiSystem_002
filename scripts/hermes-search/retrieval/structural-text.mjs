import { readFileSync } from 'node:fs';

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

export function contentQuery(text) {
  let result = stripListedTerms(text, structuralWords).replace(COUNT_EXPRESSION, ' ');
  const kept = [];
  for (const fragment of result.split(/\s+/u)) {
    if (!fragment) continue;
    const trimmed = trimParticleEdges(fragment.normalize('NFKC'));
    if (!trimmed || isParticleFragment(trimmed)) continue;
    kept.push(trimmed);
  }
  return kept.join(' ');
}
