// Night pass that learns from the day's misses, in dry-run form. Content questions that returned
// no result in Chat are searched again with a deeper candidate pool (the day judges only the top
// 15), and the relevance judge checks each candidate with a stricter cut. Accepted pairs are written
// as proposals ("add this wording to this record's enrichment"); nothing in the search changes yet.
// docs/plans/dgx-night-preparation-execplan.md describes the loop and the review before it writes.
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { execute } from './executor.mjs';
import { fieldsWithRole } from './catalog.mjs';
import { QUERY_PLAN_SCHEMA } from './query-plan.mjs';
import { RELEVANCE_CANDIDATE_LIMIT } from './relevance-jev.mjs';
import { relevanceQuery } from './structural-text.mjs';

export const PROPOSAL_SCHEMA = 'hermes-learning-proposal/v1';
export const LEARNING_STATE_SCHEMA = 'hermes-learning-state/v1';
export const DEFAULT_RECEIPT_DIR = '/app/storage/hermes-search/runtime/receipts';
export const DEFAULT_PROPOSALS_PATH = '/app/storage/hermes-search/runtime/retrieval-learning-proposals.jsonl';
export const DEFAULT_LEARNING_STATE_PATH = '/app/storage/hermes-search/runtime/retrieval-learning-state.json';
export const MAX_QUESTIONS = 20;
export const JUDGE_DEPTH = 45;
export const ACCEPT_AT = 0.7;

function tokyoDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// A night that starts at 22:00 keeps the same id after midnight, so the pass runs once per night.
export function nightOf(date) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23' }).format(date));
  if (hour >= 12) return tokyoDay(date);
  return tokyoDay(new Date(date.getTime() - 24 * 60 * 60 * 1000));
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function readReceipts(receiptsDir, days) {
  const rows = [];
  for (const day of days) {
    let text = '';
    try {
      text = await readFile(path.join(receiptsDir, `receipts-${day}.jsonl`), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row?.hermesReceipt) rows.push(row);
      } catch {
        // A torn line is skipped.
      }
    }
  }
  return rows.sort((left, right) => String(left.at ?? '').localeCompare(String(right.at ?? '')));
}

// Content questions that returned nothing, newer than the last pass, one per question text.
export function missedQuestions(receipts, afterAt = '', max = MAX_QUESTIONS) {
  const seen = new Set();
  const picked = [];
  for (const row of receipts) {
    const receipt = row.hermesReceipt;
    const at = typeof row.at === 'string' ? row.at : '';
    const question = typeof receipt.question === 'string' ? receipt.question.trim() : '';
    const semanticQuery = typeof receipt.plan?.semanticQuery === 'string' ? receipt.plan.semanticQuery.trim() : '';
    if (!question || !semanticQuery || receipt.outcome !== 'no_result' || at <= afterAt || seen.has(question)) continue;
    seen.add(question);
    picked.push({ at, question, semanticQuery, filters: Array.isArray(receipt.plan?.filters) ? receipt.plan.filters : [] });
  }
  return picked.slice(-max);
}

function filterValues(filters) {
  return filters.flatMap((filter) => (Array.isArray(filter?.values) ? filter.values : []))
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.normalize('NFKC').toLowerCase());
}

export async function proposeFromMisses({
  records,
  catalog,
  judge,
  vector = null,
  receiptsDir = DEFAULT_RECEIPT_DIR,
  proposalsPath = DEFAULT_PROPOSALS_PATH,
  statePath = DEFAULT_LEARNING_STATE_PATH,
  now = () => new Date(),
  maxQuestions = MAX_QUESTIONS,
  judgeDepth = JUDGE_DEPTH,
  acceptAt = ACCEPT_AT,
}) {
  const date = now();
  const night = nightOf(date);
  const state = await readJson(statePath);
  if (state?.schema === LEARNING_STATE_SCHEMA && state.night === night) return { reason: 'done', night };
  const days = [tokyoDay(new Date(date.getTime() - 24 * 60 * 60 * 1000)), tokyoDay(date)];
  const receipts = await readReceipts(receiptsDir, [...new Set(days)]);
  const lastAt = typeof state?.lastAt === 'string' ? state.lastAt : '';
  const questions = missedQuestions(receipts, lastAt, maxQuestions);
  const bodyFields = fieldsWithRole(catalog, 'body');
  const byId = new Map(records.map((record) => [record.id, record]));
  const proposals = [];
  let judged = 0;
  for (const item of questions) {
    const plan = {
      schema: QUERY_PLAN_SCHEMA,
      sources: [catalog.id],
      filters: item.filters,
      semanticQuery: item.semanticQuery,
      sort: 'relevance',
      limit: 5,
      display: [],
      unresolved: [],
    };
    const executed = await execute(plan, {
      records,
      catalog,
      retriever: vector ? 'hybrid' : 'lexical',
      vector,
      stageDump: true,
    });
    const ids = (executed.candidateIds ?? []).slice(0, judgeDepth);
    const query = relevanceQuery(item.semanticQuery, filterValues(item.filters)) || item.semanticQuery;
    for (let offset = 0; offset < ids.length; offset += RELEVANCE_CANDIDATE_LIMIT) {
      const batch = ids.slice(offset, offset + RELEVANCE_CANDIDATE_LIMIT)
        .map((id) => ({ id, record: byId.get(id) }))
        .filter((candidate) => candidate.record);
      if (!batch.length) continue;
      judged += batch.length;
      const result = await judge({ semanticQuery: query, candidates: batch, bodyFields });
      if (!result?.ok || !Array.isArray(result.ranked)) continue;
      for (const ranked of result.ranked) {
        if (!(Number(ranked.probability) >= acceptAt)) continue;
        proposals.push({
          schema: PROPOSAL_SCHEMA,
          night,
          askedAt: item.at,
          question: item.question,
          recordId: ranked.id,
          nonconformityNo: byId.get(ranked.id)?.nonconformityNo ?? null,
          probability: Number(ranked.probability),
          rank: ids.indexOf(ranked.id) + 1,
        });
      }
    }
  }
  await mkdir(path.dirname(proposalsPath), { recursive: true, mode: 0o700 });
  if (proposals.length) {
    await appendFile(proposalsPath, `${proposals.map((row) => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 });
  }
  const newestAt = questions.length ? questions.at(-1).at : lastAt;
  const nextState = {
    schema: LEARNING_STATE_SCHEMA,
    night,
    lastAt: newestAt > lastAt ? newestAt : lastAt,
    questions: questions.length,
    judged,
    proposals: proposals.length,
    updatedAt: date.toISOString(),
  };
  await writeFile(statePath, `${JSON.stringify(nextState)}\n`, { mode: 0o600 });
  return { reason: 'completed', ...nextState };
}
