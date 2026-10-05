import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bareId } from './flywheel-pairs.mjs';

export const LEARNED_SCHEMA = 'hermes-flywheel-learned/v1';
export const DEFAULT_LEARN_BUDGET = 30;
export const LEARN_BUDGET_CAP = 100;
export const LEARN_EVAL_NIGHTS = 3;

export function learnedPath(dir) {
  return path.join(dir, 'learned-queries.jsonl');
}

export function learnedPathFromEnv(env = process.env) {
  return env.HERMES_FLYWHEEL_LEARNED_PATH || '/app/storage/hermes-search/runtime/flywheel/learned-queries.jsonl';
}

export async function readLearned(filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((line) => {
    try {
      const row = JSON.parse(line);
      return row?.schema === LEARNED_SCHEMA && typeof row.recordId === 'string' && row.recordId
        && typeof row.query === 'string' && row.query.trim()
        && ['synthetic', 'real'].includes(row.source) && typeof row.from === 'string' && row.from
        && typeof row.night === 'string' && typeof row.at === 'string'
        && ['candidate', 'active', 'rejected'].includes(row.state) ? [row] : [];
    } catch {
      return [];
    }
  });
}

export async function writeLearned(filePath, rows) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, rows.map((row) => `${JSON.stringify(row)}\n`).join(''), { mode: 0o600 });
  await rename(temporary, filePath);
}

// Keep the gate's FNV-1a split here: importing gate would reach live and worker again.
function syntheticSplit(id) {
  let hash = 0x811c9dc5;
  for (const char of bareId(id)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100 < 70 ? 'dev' : 'heldout';
}

// Same relevance rule as live, without importing the scorer/worker dependency chain.
function syntheticRelevant(row) {
  const ids = [bareId(row.a)];
  if (row.b && row.grades?.dgx?.b === 3 && row.grades?.jev?.b === 3) ids.push(bareId(row.b));
  return ids.filter(Boolean);
}

const queryKey = (recordId, query) => JSON.stringify([bareId(recordId), query.normalize('NFKC')]);

export function proposeLearnedQueries({ rows, existing = [], night, budget = DEFAULT_LEARN_BUDGET }) {
  const seen = new Set(existing.map((row) => queryKey(row.recordId, row.query)));
  const proposed = [];
  const at = new Date().toISOString();
  for (const row of rows) {
    if (proposed.length >= budget) break;
    const real = row?.source === 'real';
    if (!row || (!real && row.kept !== true) || typeof row.question !== 'string' || !row.question.trim()) continue;
    if ((real ? row.split : syntheticSplit(row.a)) !== 'dev') continue;
    if (!['not_in_pool', 'judge_rejected'].includes(row.live?.loss)) continue;
    const relevant = (real ? row.relevant ?? [] : syntheticRelevant(row)).map(bareId).filter(Boolean);
    const from = real ? row.id : bareId(row.a);
    if (!relevant.length || !from) continue;
    const recordId = relevant[0];
    const key = queryKey(recordId, row.question);
    if (seen.has(key)) continue;
    seen.add(key);
    proposed.push({ schema: LEARNED_SCHEMA, recordId, query: row.question, source: real ? 'real' : 'synthetic', from, night, state: 'candidate', at });
  }
  return proposed;
}

export function learnedQueriesById(rows, { states = ['active'] } = {}) {
  const byId = new Map();
  for (const row of rows) {
    // null attaches exactly the supplied rows, as used by the candidate scorer.
    if (states && !states.includes(row.state)) continue;
    const recordId = bareId(row.recordId);
    if (!recordId || typeof row.query !== 'string' || !row.query.trim()) continue;
    const queries = byId.get(recordId) ?? [];
    if (queries.some((query) => query.normalize('NFKC') === row.query.normalize('NFKC'))) continue;
    queries.push(row.query);
    byId.set(recordId, queries);
  }
  return byId;
}

export function mergeLearnedQueries(enrichmentById, learned, { states = ['active'] } = {}) {
  const merged = new Map(enrichmentById);
  for (const row of learned) {
    if (states && !states.includes(row.state)) continue;
    const recordId = bareId(row.recordId);
    if (!recordId || typeof row.query !== 'string' || !row.query.trim()) continue;
    const stored = merged.get(recordId) ?? { schema: 'hermes-retrieval-enrichment/v1', recordId, queries: [] };
    const queries = [...(stored.queries ?? [])];
    if (queries.some((query) => query.normalize('NFKC') === row.query.normalize('NFKC'))) continue;
    queries.push(row.query);
    merged.set(recordId, { ...stored, queries });
  }
  return merged;
}

export async function evaluateCandidates({ questions, scoreBaseline, scoreCandidate }) {
  const check = { heldout: { n: 0, gained: 0, lost: 0 }, real: { n: 0, gained: 0, lost: 0 } };
  for (const question of questions) {
    const row = { a: null, b: null, question: question.question, grades: null };
    const wanted = new Set(question.relevant.map(bareId));
    const hit = (result) => (result.shown ?? []).map(bareId).some((id) => wanted.has(id));
    const before = hit(await scoreBaseline(row));
    const after = hit(await scoreCandidate(row));
    for (const counts of [check.heldout, ...(question.source === 'real' ? [check.real] : [])]) {
      counts.n += 1;
      if (!before && after) counts.gained += 1;
      if (before && !after) counts.lost += 1;
    }
  }
  return check;
}

export function activationDecision(check) {
  return check.heldout.lost <= check.heldout.gained && check.real.lost <= check.real.gained ? 'active' : 'rejected';
}
