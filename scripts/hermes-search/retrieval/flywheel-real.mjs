// Real kiosk questions; only questions, receipt metadata, and record ids leave the receipts.
import { createHash } from 'node:crypto';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bareId } from './flywheel-pairs.mjs';

// A first turn is identified by its text alone; a follow-up by its text and the plan it follows,
// so the same 「他に何件ある？」 after two different searches is two questions.
export function realId(question, previousPlan = null) {
  const hash = createHash('sha1').update(question.normalize('NFKC').trim());
  if (previousPlan) hash.update('\n').update(JSON.stringify(previousPlan));
  return `r-${hash.digest('hex').slice(0, 16)}`;
}

// The part of a day plan the planner reads back as previous_plan, with stable key order.
export function planSummary(plan) {
  if (!plan || typeof plan !== 'object') return null;
  return {
    sources: Array.isArray(plan.sources) ? plan.sources : [],
    filters: Array.isArray(plan.filters) ? plan.filters : [],
    ...(plan.causeCategory !== undefined ? { causeCategory: plan.causeCategory } : {}),
    semanticQuery: typeof plan.semanticQuery === 'string' ? plan.semanticQuery : '',
    ...(typeof plan.contentSpan === 'string' ? { contentSpan: plan.contentSpan } : {}),
    sort: plan.sort ?? null,
    limit: plan.limit ?? null,
  };
}

export function readRealRows(text) {
  return String(text ?? '').split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

async function readRows(file) {
  try {
    return readRealRows(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
}

function qualifies(receipt, followUp) {
  const question = receipt?.question;
  const semanticQuery = receipt?.plan?.semanticQuery;
  const hasContent = typeof semanticQuery === 'string' && semanticQuery.trim();
  // A question that only names a department or a period has no content condition but is
  // scored on its filters at night (flywheel-filter-check.mjs), so it joins the set too.
  const plan = receipt?.plan;
  const hasFilters = Array.isArray(plan?.filters) && plan.filters.length > 0;
  const recent = plan?.sort === 'recent' || plan?.sort?.direction === 'desc';
  // A follow-up takes its conditions from the turn before it, so it joins without any of its own.
  return typeof question === 'string' && question.trim()
    && (followUp || hasContent || hasFilters || recent)
    && ['answer', 'no_result', 'no_other', 'count'].includes(receipt.outcome);
}

function shownOf(row) {
  return Array.isArray(row.recordIds) ? row.recordIds.filter((id) => typeof id === 'string' && id) : [];
}

/**
 * Receipt questions in kiosk order. Receipts sharing a sessionId form one conversation: every
 * turn after the first carries the previous turn's plan, the records shown so far, and the
 * earlier questions, so the night replays it the way the kiosk heard it. Receipts without a
 * sessionId are first turns on their own.
 */
export async function readReceiptQuestions({ receiptsDir, days }) {
  const rows = [];
  const requestIds = new Set();
  for (const day of new Set(days)) {
    for (const row of await readRows(path.join(receiptsDir, `receipts-${day}.jsonl`))) {
      if (!row?.hermesReceipt || typeof row.at !== 'string') continue;
      if (row.requestId) {
        if (requestIds.has(row.requestId)) continue;
        requestIds.add(row.requestId);
      }
      rows.push(row);
    }
  }
  const sessions = new Map();
  for (const row of rows) {
    const key = typeof row.sessionId === 'string' && row.sessionId ? row.sessionId : null;
    if (!key) {
      sessions.set(Symbol('standalone'), [row]);
      continue;
    }
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(row);
  }
  const questions = new Map();
  for (const turns of sessions.values()) {
    turns.sort((left, right) => left.at.localeCompare(right.at));
    let previousPlan = null;
    let previousShown = [];
    const context = [];
    turns.forEach((row, turn) => {
      const receipt = row.hermesReceipt;
      // A chip click (refine) skipped the planner on the kiosk: its question text is the earlier
      // question echoed, so it is not replayed; its narrowed plan is what the next turn follows,
      // and the kiosk forgets the records shown before it.
      const chip = Boolean(receipt.refine);
      if (chip) {
        previousPlan = planSummary(receipt.plan) ?? previousPlan;
        previousShown = shownOf(row);
        return;
      }
      if (qualifies(receipt, Boolean(previousPlan))) {
        const id = realId(receipt.question, previousPlan);
        if (!questions.has(id)) {
          questions.set(id, {
            id, question: receipt.question, receiptAt: row.at, dayOutcome: receipt.outcome,
            dayShown: shownOf(row).map(bareId),
            turn,
            ...(previousPlan ? { previousPlan, previousShown: [...previousShown], context: [...context] } : {}),
          });
        }
      }
      // The kiosk carries this turn's plan into the next question whatever the outcome was.
      previousPlan = planSummary(receipt.plan) ?? previousPlan;
      previousShown = [...previousShown.filter((id) => !shownOf(row).includes(id)), ...shownOf(row)];
      if (typeof receipt.question === 'string' && receipt.question.trim()) context.push(receipt.question);
    });
  }
  return [...questions.values()];
}

export function realPath(dir, night) {
  return path.join(dir, `real-${night}.jsonl`);
}

export async function readRegressions(dir) {
  return new Map((await readRows(path.join(dir, 'regressions.jsonl'))).filter((row) => row?.id).map((row) => [row.id, row]));
}

export async function writeRegressions(dir, regressions) {
  const file = path.join(dir, 'regressions.jsonl');
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, [...regressions.values()].map((row) => `${JSON.stringify(row)}\n`).join(''), { mode: 0o600 });
  await rename(temporary, file);
}

export function regressionOk(row) {
  if (row.followUpCheck?.supported === true) return row.followUpCheck.ok;
  return row.filterCheck?.ok ?? null;
}

export function updateRegression(regressions, row, night) {
  if (!['real', 'regression'].includes(row.source)) return;
  const prior = regressions.get(row.id);
  const ok = regressionOk(row);
  if ((!prior && ok !== false) || prior?.lastNight === night) return;
  const yesterday = new Date(Date.parse(`${night}T12:00:00Z`) - 24 * 3600 * 1000).toISOString().slice(0, 10);
  // lastOk is the consecutive successful-night count; gaps and unsupported checks reset it.
  const lastOk = ok === true ? (prior?.lastNight === yesterday ? prior.lastOk : 0) + 1 : 0;
  const lastUnsupported = ok === null ? (prior?.lastNight === yesterday ? prior.lastUnsupported ?? 0 : 0) + 1 : 0;
  if (lastOk >= 3 || lastUnsupported >= 3) {
    regressions.delete(row.id);
    return;
  }
  regressions.set(row.id, {
    id: row.id, question: row.question, previousPlan: row.previousPlan ?? null,
    previousShown: row.previousShown ?? [], context: row.context ?? [], receiptAt: row.receiptAt,
    firstFailedNight: prior?.firstFailedNight ?? night, lastNight: night, lastOk, lastUnsupported,
  });
}

export async function existingRealIds(dir) {
  const ids = new Set();
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return ids;
  }
  for (const name of names.filter((item) => /^real-\d{4}-\d{2}-\d{2}\.jsonl$/u.test(item))) {
    for (const row of await readRows(path.join(dir, name))) if (row?.id) ids.add(row.id);
  }
  return ids;
}
