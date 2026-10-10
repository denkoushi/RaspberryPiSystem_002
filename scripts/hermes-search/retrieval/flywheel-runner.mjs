// Nightly runner for the synthetic question flywheel (hermes-synthetic-question-flywheel-execplan.md,
// Milestone 3). The API process starts it with the corpus on stdin when HERMES_FLYWHEEL_ENABLED is
// true. Inside the night window it samples contrastive record pairs, has the DGX business LLM
// write one question per pair, grades each question with the DGX business LLM and with JEV, and
// appends one line per question to runtime/flywheel/questions-YYYY-MM-DD.jsonl (Tokyo date).
// Lines hold record ids, the seed, the question, grades, and the keep decision; no record text.
// After generation and grading finish, kept questions without live results are answered by the
// kiosk's own pipeline, recording the shown and judged ids and the loss stage (flywheel-live.mjs).
// A nightly budget caps the questions, and a busy guard stops calling the model when it is slow.
import { appendFile, mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogEntries, fieldsWithRole, loadNonconformityCatalog } from './catalog.mjs';
import { denseSettings, readDenseStore } from './dense-dgx.mjs';
import { enrichmentSettings, withinWindow } from './enrichment-dgx.mjs';
import { createDgxGrader, createJevPairGrader, filterAndLabel } from './flywheel-filter.mjs';
import { checkFilterAnswer, filterOutcome, isFilterOnlyPlan } from './flywheel-filter-check.mjs';
import { sampleFilterQuestions } from './flywheel-filter-questions.mjs';
import { createDgxChat, generateForPairs, guardChat, probeChat } from './flywheel-generate.mjs';
import { createLiveScorer, lossStage, relevantIds } from './flywheel-live.mjs';
import { questionSet, splitOf } from './flywheel-gate.mjs';
import { DEFAULT_LEARN_BUDGET, LEARN_BUDGET_CAP, LEARN_EVAL_NIGHTS, activationDecision, evaluateCandidates, learnedPath, proposeLearnedQueries, readLearned, writeLearned } from './flywheel-learn.mjs';
import { existingRealIds, readReceiptQuestions, realPath } from './flywheel-real.mjs';
import { answerableIntents, bareId, bodyText, samplePairs } from './flywheel-pairs.mjs';
import { createRandom, sampleSeed } from './flywheel-seeds.mjs';
import { GRADE_BATCH, gradeBatch, recordText } from './graded-labels.mjs';

export const DEFAULT_FLYWHEEL_DIR = '/app/storage/hermes-search/runtime/flywheel';
export const DEFAULT_MAX_QUESTIONS = 100;
export const MAX_QUESTIONS_CAP = 500;
export const DEFAULT_LABEL_BUDGET = 60;
export const LABEL_BUDGET_CAP = 300;
export const DEFAULT_REAL_BUDGET = 20;
export const REAL_BUDGET_CAP = 100;
export const DEFAULT_FILTER_BUDGET = 10;
export const FILTER_BUDGET_CAP = 30;
export const REAL_LABEL_DEPTH = 5;

export function flywheelSettings(env = process.env) {
  const requested = Number.parseInt(env.HERMES_FLYWHEEL_MAX_QUESTIONS ?? '', 10);
  const labelBudget = Number(env.HERMES_FLYWHEEL_LABEL_BUDGET ?? NaN);
  const realBudget = Number(env.HERMES_FLYWHEEL_REAL_BUDGET ?? NaN);
  const filterBudget = Number(env.HERMES_FLYWHEEL_FILTER_BUDGET ?? NaN);
  const learnBudget = Number(env.HERMES_FLYWHEEL_LEARN_BUDGET ?? NaN);
  const inference = enrichmentSettings(env);
  return {
    enabled: env.HERMES_FLYWHEEL_ENABLED === 'true',
    maxQuestions: Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_QUESTIONS_CAP) : DEFAULT_MAX_QUESTIONS,
    labelBudget: Number.isInteger(labelBudget) && labelBudget >= 0 && env.HERMES_FLYWHEEL_LABEL_BUDGET?.trim() !== '' ? Math.min(labelBudget, LABEL_BUDGET_CAP) : DEFAULT_LABEL_BUDGET,
    realBudget: Number.isInteger(realBudget) && realBudget >= 0 && env.HERMES_FLYWHEEL_REAL_BUDGET?.trim() !== '' ? Math.min(realBudget, REAL_BUDGET_CAP) : DEFAULT_REAL_BUDGET,
    filterBudget: Number.isInteger(filterBudget) && filterBudget >= 0 && env.HERMES_FLYWHEEL_FILTER_BUDGET?.trim() !== '' ? Math.min(filterBudget, FILTER_BUDGET_CAP) : DEFAULT_FILTER_BUDGET,
    learnBudget: Number.isInteger(learnBudget) && learnBudget >= 0 && env.HERMES_FLYWHEEL_LEARN_BUDGET?.trim() !== '' ? Math.min(learnBudget, LEARN_BUDGET_CAP) : DEFAULT_LEARN_BUDGET,
    window: env.HERMES_RETRIEVAL_ENRICHMENT_WINDOW || '',
    dir: env.HERMES_FLYWHEEL_DIR || DEFAULT_FLYWHEEL_DIR,
    denseStore: denseSettings(env).storePath,
    origin: inference.origin,
    token: inference.token,
    egress: inference.egress,
    model: inference.model,
  };
}

export function tokyoDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function questionsPath(dir, day) {
  return path.join(dir, `questions-${day}.jsonl`);
}

/**
 * Night file of a run. The window ends at 6 in the morning, so a night that starts at 22 on one
 * day and continues after midnight keeps writing to the file of the day it started.
 */
export function nightOf(date) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23' }).format(date));
  return hour < 12 ? tokyoDay(new Date(date.getTime() - 12 * 3600 * 1000)) : tokyoDay(date);
}

async function readLines(filePath) {
  try {
    return (await readFile(filePath, 'utf8')).split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        // Unparseable lines are omitted, including when live results rewrite the night file.
        return [];
      }
    });
  } catch {
    return [];
  }
}

/** Anchor ids used on any night, so a record anchors at most one question. */
export async function usedAnchors(dir) {
  const used = new Set();
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return used;
  }
  for (const name of names.filter((item) => /^questions-\d{4}-\d{2}-\d{2}\.jsonl$/u.test(item))) {
    for (const row of await readLines(path.join(dir, name))) if (row?.kind !== 'filter' && row?.a) used.add(row.a);
  }
  return used;
}

async function writeJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

function countLine(status) {
  return [
    'hermes retrieval flywheel',
    `reason=${status.reason}`,
    `night=${status.night ?? 'na'}`,
    `generated=${status.generated}`,
    `kept=${status.kept}`,
    `shown=${status.shown}`,
    `dropped=${status.dropped}`,
    `pending=${status.pendingLive}`,
    `labelled=${status.labelled}`,
    `labelPending=${status.labelPending}`,
    `real=${status.real}`,
    `filter=${Object.entries(status.filter).map(([key, value]) => `${key}:${value}`).join(',')}`,
    `learned=${status.learned?.proposed ?? 0}/${status.learned?.decision ?? 'pending'}`,
  ].join(' ');
}

function shownRelevantWithLabels(row, labels) {
  const relevant = new Set(relevantIds(row));
  return (row.live.shown ?? []).map(bareId).some((id) => relevant.has(id) || labels[bareId(row.a)]?.[id]?.g === 3);
}

function unlabelledShownPairs(rows, labels) {
  const groups = new Map();
  for (const row of rows) {
    if (row.kind === 'filter' || row.kept !== true || !row.question || row.live?.loss !== 'other_shown') continue;
    const anchor = bareId(row.a);
    const relevant = new Set(relevantIds(row));
    for (const id of (row.live.shown ?? []).map(bareId)) {
      if (relevant.has(id) || labels[anchor]?.[id] != null) continue;
      if (!groups.has(anchor)) groups.set(anchor, { question: row.question, ids: new Set() });
      groups.get(anchor).ids.add(id);
    }
  }
  return groups;
}

/**
 * One night pass. Injectable: now, readDense, chat (the raw DGX chat), probe, jevEvaluate, live (the
 * scorer from createLiveScorer), liveFactory, and the random seed. Returns the status that is also written to
 * flywheel-status.json.
 */
export async function runFlywheelNight({
  records,
  settings,
  now = () => new Date(),
  readDense = readDenseStore,
  chat = null,
  probe = probeChat,
  jevEvaluate = null,
  live = null,
  liveFactory = null,
  seed = null,
  log = (line) => console.info(line),
}) {
  const status = { schema: 'hermes-flywheel-status/v1', reason: 'started', night: null, generated: 0, kept: 0, shown: 0, dropped: 0, dropReasons: {}, lossStages: {}, pendingLive: 0, labelled: 0, labelPending: 0, real: 0, realPending: 0, filter: { generated: 0, ok: 0, mismatch: 0, unsupported: 0, clarified: 0, failed: 0 }, updatedAt: null };
  let previousReason = null;
  if (settings.dir) {
    try {
      previousReason = JSON.parse(await readFile(path.join(settings.dir, 'flywheel-status.json'), 'utf8'))?.reason ?? null;
    } catch {
      // Missing or unreadable status means the next final line must be written.
    }
  }
  const nightLog = async (line, final = false) => {
    if (!settings.dir) return;
    const worked = [status.generated, status.kept, status.shown, status.dropped, status.labelled, status.real, status.filter.generated,
      status.learned?.proposed ?? 0, status.learned?.candidates ?? 0].some((count) => count > 0);
    if (final && !worked && status.reason === previousReason) return;
    try {
      const at = now();
      await appendFile(path.join(settings.dir, `runner-${status.night ?? nightOf(at)}.log`),
        `${at.toISOString()} ${String(line).replace(/[\r\n]/gu, ' ')}\n`, { mode: 0o600 });
    } catch {
      // Diagnostics must never interrupt generation or scoring.
    }
  };
  const writeLog = async (line, final = false) => {
    log(line);
    await nightLog(line, final);
  };
  const logLive = (id, result) => nightLog(`hermes retrieval flywheel live id=${id} outcome=${result.outcome} loss=${result.loss ?? 'none'} reason=${JSON.stringify(result.reason ?? null)} ms=${result.ms}`);
  const finish = async (reason) => {
    status.reason = reason;
    status.updatedAt = now().toISOString();
    if (settings.dir) {
      await mkdir(settings.dir, { recursive: true, mode: 0o700 });
      await writeJson(path.join(settings.dir, 'flywheel-status.json'), status);
    }
    await writeLog(countLine(status), true);
    return status;
  };
  if (!settings.enabled) return finish('disabled');
  if (!withinWindow(settings.window, now())) return finish('outside_window');
  if (!chat && (!settings.origin || !settings.token)) return finish('not_configured');
  status.night = nightOf(now());
  await mkdir(settings.dir, { recursive: true, mode: 0o700 });
  const filePath = questionsPath(settings.dir, status.night);
  const done = (await readLines(filePath)).filter((row) => row.kind !== 'filter').length;
  const budget = settings.maxQuestions - done;

  const catalog = loadNonconformityCatalog();
  const bodyFields = fieldsWithRole(catalog, 'body');
  const fieldLabels = Object.fromEntries(catalogEntries(catalog).flatMap((entry) => entry.fields.map((field) => [field.key, field.label])));
  const corpus = (records ?? []).map((record) => ({ ...record, id: bareId(record.id) }));
  const recordsById = new Map(corpus.map((record) => [record.id, record]));
  let denseEntries = [];
  try {
    denseEntries = await readDense(settings.denseStore);
  } catch {
    return finish('dense_unavailable');
  }
  let evaluate = jevEvaluate;
  if (!evaluate) {
    const { createTypesafeDirectEvaluate } = await import('../hermes-jev-record-pilot.mjs');
    evaluate = createTypesafeDirectEvaluate();
  }
  let reason = budget <= 0 ? 'budget_reached' : 'completed';
  const rawChat = chat ?? createDgxChat({ origin: settings.origin, token: settings.token, egress: settings.egress, model: settings.model });
  const guarded = guardChat(rawChat);
  const gradeDgx = createDgxGrader(guarded);

  // Both phases use the same consensus rule and persist each finished JEV batch.
  async function gradeIdsForQuestion({ question, ids, budget = Infinity, onBatch }) {
    const entries = {};
    for (let index = 0; index < ids.length;) {
      const items = [];
      const dgxGrades = new Map();
      while (index < ids.length && items.length < GRADE_BATCH && Object.keys(entries).length + items.length < budget) {
        if (!withinWindow(settings.window, now()) || guarded.tripped()) break;
        const id = ids[index++];
        if (!recordsById.has(id)) continue;
        const text = recordText(recordsById.get(id), bodyFields, fieldLabels);
        dgxGrades.set(id, await gradeDgx(question, text));
        items.push({ id, text });
      }
      if (!items.length) break;
      let graded = {};
      try {
        graded = await gradeBatch({ evaluate, question, items });
      } catch {
        // Failed or unanswered JEV grades are persisted as null, never as relevant.
      }
      const batch = {};
      for (const { id } of items) {
        const dgx = dgxGrades.get(id);
        const jev = graded[id]?.g ?? null;
        const g = dgx === 3 && jev === 3 ? 3 : dgx == null || jev == null ? null : Math.min(dgx, jev);
        batch[id] = { g, dgx, jev, night: status.night };
      }
      Object.assign(entries, batch);
      await onBatch(batch);
      if (guarded.tripped()) break;
    }
    return entries;
  }
  if (budget > 0) {
    const random = createRandom(seed ?? Number(status.night.replaceAll('-', '')) + done);
    const exclude = await usedAnchors(settings.dir);
    const denseIds = new Set(denseEntries.map((entry) => bareId(entry.id)));
    const pool = corpus.filter((record) => bodyText(record) && denseIds.has(record.id));
    if (pool.length > 1 && pool.some((record) => !exclude.has(record.id))) {
      status.probe = await probe(rawChat);
      if (!status.probe.ok) {
        reason = 'dgx_not_ready';
        await writeLog(`hermes retrieval flywheel dgx not ready reason=${status.probe.reason}`);
      }
    }
    const pairs = reason === 'dgx_not_ready' ? [] : samplePairs({ records: corpus, denseEntries, count: budget, random, exclude });
    if (!pairs.length) {
      if (reason !== 'dgx_not_ready') reason = 'no_pairs';
    } else {
      const gradeJevPair = createJevPairGrader(evaluate);
      for (const pair of pairs) {
        if (!withinWindow(settings.window, now())) {
          reason = 'outside_window';
          break;
        }
        if (guarded.tripped()) {
          reason = 'dgx_busy';
          break;
        }
        const [generated] = await generateForPairs({ pairs: [pair], recordsById, random, chat: guarded, sampleSeed, answerableIntents, bodyText });
        const [row] = await filterAndLabel({ rows: [generated], recordsById, bodyFields, fieldLabels, gradeDgx, gradeJevPair });
        const line = {
          at: now().toISOString(),
          a: row.a,
          b: row.b,
          similarity: row.similarity,
          seed: row.seed,
          question: row.ok ? row.question : null,
          grades: row.grades ?? null,
          kept: row.kept === true,
          reason: row.ok ? row.reason ?? null : row.reason,
          overlap: row.overlap ?? null,
          retried: row.retried === true,
        };
        await appendFile(filePath, `${JSON.stringify(line)}\n`, { mode: 0o600 });
        if (row.ok) status.generated += 1;
        if (line.kept) status.kept += 1;
        else {
          status.dropped += 1;
          const key = line.reason ?? 'unknown';
          status.dropReasons[key] = (status.dropReasons[key] ?? 0) + 1;
        }
      }
      if (reason === 'completed' && guarded.tripped()) reason = 'dgx_busy';
    }
  }

  // The scorer builds the kiosk's index over the whole corpus, so it is created only when a kept
  // row still lacks a live result; most five-minute starts inside the window have none.
  let score = live;
  const makeLive = liveFactory ?? (live ? async () => live : createLiveScorer);
  const rows = await readLines(filePath);
  let scored = false;
  for (const row of rows) {
    if (row.kind === 'filter' || row.kept !== true || !row.question || row.live) continue;
    if (!withinWindow(settings.window, now())) break;
    score ??= await makeLive({ records, catalog, evaluate });
    row.live = { ...await score(row) };
    row.live.reason ??= null;
    await logLive(row.a, row.live);
    scored = true;
  }
  if (scored) {
    const temporary = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 });
    await rename(temporary, filePath);
  }

  const labelsPath = path.join(settings.dir, 'labels.json');
  let labels = {};
  try {
    const stored = JSON.parse(await readFile(labelsPath, 'utf8'));
    labels = stored.schema === 'hermes-flywheel-labels/v1' ? stored.labels : stored;
    if (!labels || typeof labels !== 'object' || Array.isArray(labels)) labels = {};
  } catch (error) {
    // A missing file starts empty; an unreadable one is replaced rather than stopping the night.
    if (error.code !== 'ENOENT') await writeLog('hermes retrieval flywheel labels unreadable, starting empty');
    labels = {};
  }
  // Real-question labels have their own question budget, including partially graded questions.
  const spent = Object.entries(labels).filter(([id]) => !/^r-[0-9a-f]{16}$/u.test(id))
    .reduce((sum, [, entries]) => sum + Object.values(entries).filter((label) => label.night === status.night).length, 0);
  const remaining = Math.max(0, (settings.labelBudget ?? DEFAULT_LABEL_BUDGET) - spent);
  const groups = unlabelledShownPairs(rows, labels);
  for (const [anchor, group] of groups) {
    if (status.labelled >= remaining || !withinWindow(settings.window, now()) || guarded.tripped()) break;
    await gradeIdsForQuestion({
      question: group.question, ids: [...group.ids], budget: remaining - status.labelled,
      onBatch: async (batch) => {
        labels[anchor] ??= {};
        Object.assign(labels[anchor], batch);
        status.labelled += Object.keys(batch).length;
        await writeJson(labelsPath, { schema: 'hermes-flywheel-labels/v1', labels });
      },
    });
    if (guarded.tripped()) {
      reason = 'dgx_busy';
      break;
    }
  }
  for (const [anchor, group] of groups) {
    status.labelPending += [...group.ids].filter((id) => labels[anchor]?.[id] == null).length;
  }
  let relabelled = false;
  for (const row of rows) {
    if (row.kind === 'filter' || row.kept !== true || row.live?.loss !== 'other_shown' || !shownRelevantWithLabels(row, labels)) continue;
    row.live.loss = null;
    row.live.labelled = true;
    relabelled = true;
  }
  if (relabelled) {
    const temporary = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 });
    await rename(temporary, filePath);
  }
  for (const row of rows) {
    if (row.kind === 'filter' || row.kept !== true) continue;
    if (!row.live) status.pendingLive += 1;
    else if (row.live.loss == null) status.shown += 1;
    else status.lossStages[row.live.loss] = (status.lossStages[row.live.loss] ?? 0) + 1;
  }
  // Filter rows have their own nightly budget and never enter content grading or learning.
  const filterDone = rows.filter((row) => row.kind === 'filter');
  const filterIds = new Set(filterDone.map((row) => row.id));
  const filterTexts = new Set(filterDone.map((row) => row.question));
  const filterBudget = settings.filterBudget ?? DEFAULT_FILTER_BUDGET;
  const filterQuestions = sampleFilterQuestions({ records: corpus, catalog, count: filterBudget,
    random: createRandom(seed ?? Number(status.night.replaceAll('-', ''))), now: now() });
  let filterRemaining = Math.max(0, filterBudget - filterDone.length);
  for (const question of filterQuestions) {
    if (filterRemaining <= 0 || !withinWindow(settings.window, now())) break;
    if (filterIds.has(question.id) || filterTexts.has(question.question)) continue;
    score ??= await makeLive({ records, catalog, evaluate });
    const live = { ...await score({ ...question, kind: 'filter', relevant: [] }) };
    live.reason ??= null;
    const filterCheck = checkFilterAnswer({ plan: live.plan, shown: live.shown, records: corpus, catalog });
    live.loss = filterCheck.ok === true ? null : filterCheck.ok === false ? 'filter_mismatch' : 'filter_unsupported';
    await logLive(question.id, live);
    const row = { at: now().toISOString(), source: 'synthetic', kind: 'filter', ...question,
      relevant: [], labels: {}, live, filterCheck };
    await appendFile(filePath, `${JSON.stringify(row)}\n`, { mode: 0o600 });
    filterRemaining -= 1;
    status.filter.generated += 1;
    status.filter[filterOutcome(row)] += 1;
  }
  const realFile = realPath(settings.dir, status.night);
  const realDone = (await readLines(realFile)).length;
  const realRemaining = Math.max(0, (settings.realBudget ?? DEFAULT_REAL_BUDGET) - realDone);
  const usedReal = await existingRealIds(settings.dir);
  const receiptQuestions = (await readReceiptQuestions({
    receiptsDir: path.join(path.dirname(settings.dir), 'receipts'),
    days: [status.night, tokyoDay(new Date(now().getTime() - 24 * 3600 * 1000))],
  })).filter((question) => !usedReal.has(question.id));
  status.realPending = receiptQuestions.length;
  for (const question of receiptQuestions.slice(0, realRemaining)) {
    if (guarded.tripped()) {
      reason = 'dgx_busy';
      break;
    }
    if (!withinWindow(settings.window, now())) break;
    score ??= await makeLive({ records, catalog, evaluate });
    const live = await score({ a: null, b: null, question: question.question, grades: null });
    await logLive(question.id, live);
    if (isFilterOnlyPlan(live.plan)) {
      const filterCheck = checkFilterAnswer({ plan: live.plan, shown: live.shown, records: corpus, catalog });
      live.loss = filterCheck.ok === true ? null : filterCheck.ok === false ? 'filter_mismatch' : 'filter_unsupported';
      await appendFile(realFile, `${JSON.stringify({
        at: now().toISOString(), source: 'real', ...question, split: splitOf(question.id),
        kind: 'filter', relevant: [], labels: {}, live, filterCheck,
      })}\n`, { mode: 0o600 });
      status.real += 1;
      status.realPending -= 1;
      continue;
    }
    const ids = [...new Set([
      ...(live.candidates ?? []).slice(0, REAL_LABEL_DEPTH), ...(live.shown ?? []), ...question.dayShown,
    ].map(bareId))].filter((id) => recordsById.has(id));
    labels[question.id] ??= {};
    await gradeIdsForQuestion({
      question: question.question, ids: ids.filter((id) => labels[question.id][id] == null),
      onBatch: async (batch) => {
        Object.assign(labels[question.id], batch);
        await writeJson(labelsPath, { schema: 'hermes-flywheel-labels/v1', labels });
      },
    });
    if (guarded.tripped()) reason = 'dgx_busy';
    // A partially graded question stays pending; its saved labels are reused next time.
    if (ids.some((id) => labels[question.id][id] == null)) break;
    const questionLabels = Object.fromEntries(ids.map((id) => {
      const { g, dgx, jev } = labels[question.id][id];
      return [id, { g, dgx, jev }];
    }));
    const relevant = ids.filter((id) => questionLabels[id].g === 3);
    live.loss = lossStage({ relevant, outcome: live.outcome, shown: live.shown, candidates: live.candidates, judged: live.judged });
    await writeJson(labelsPath, { schema: 'hermes-flywheel-labels/v1', labels });
    await appendFile(realFile, `${JSON.stringify({
      at: now().toISOString(), source: 'real', ...question, split: splitOf(question.id), kind: 'content', relevant, labels: questionLabels, live,
    })}\n`, { mode: 0o600 });
    status.real += 1;
    status.realPending -= 1;
  }
  // Learn only from development failures; all comparisons use held-out questions.
  const recentRows = [];
  const nightDate = new Date(`${status.night}T12:00:00+09:00`);
  for (let offset = 0; offset < LEARN_EVAL_NIGHTS; offset += 1) {
    const day = tokyoDay(new Date(nightDate.getTime() - offset * 24 * 3600 * 1000));
    recentRows.push(...await readLines(questionsPath(settings.dir, day)), ...await readLines(realPath(settings.dir, day)));
  }
  const learnedFile = learnedPath(settings.dir);
  const existing = await readLearned(learnedFile);
  const proposed = proposeLearnedQueries({ rows: recentRows, existing, night: status.night, budget: settings.learnBudget ?? DEFAULT_LEARN_BUDGET });
  const learned = [...existing, ...proposed];
  if (proposed.length) await writeLearned(learnedFile, learned);
  const candidates = learned.filter((row) => row.state === 'candidate');
  status.learned = { proposed: proposed.length, candidates: candidates.length, decision: null, check: null };
  // Pending candidates must resume even when deduplication produces no new proposals.
  if (candidates.length && withinWindow(settings.window, now())) {
    const questions = questionSet(recentRows).filter((question) => question.split === 'heldout');
    score ??= await makeLive({ records, catalog, evaluate });
    const candidateScore = await makeLive({ records, catalog, evaluate, learned: candidates });
    let expired = false;
    const inWindow = (scorer, mode) => async (row) => {
      if (!withinWindow(settings.window, now())) {
        expired = true;
        throw new Error('learn_window_expired');
      }
      const result = await scorer(row);
      await logLive(`${mode}:${row.id ?? row.a}`, result);
      return result;
    };
    try {
      const check = await evaluateCandidates({ questions, scoreBaseline: inWindow(score, 'baseline'), scoreCandidate: inWindow(candidateScore, 'candidate') });
      if (withinWindow(settings.window, now())) {
        const decision = activationDecision(check);
        const decidedAt = now().toISOString();
        await writeLearned(learnedFile, learned.map((row) => row.state === 'candidate' ? { ...row, state: decision, check, decidedAt } : row));
        Object.assign(status.learned, { decision, check });
      }
    } catch (error) {
      if (!expired) throw error;
    }
  }
  if (guarded.tripped()) reason = 'dgx_busy';
  return finish(reason);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return [];
  const payload = JSON.parse(raw);
  return Array.isArray(payload) ? payload : payload.records;
}

export const RUNNER_LOCK_STALE_MS = 2 * 3600 * 1000;

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * One runner per night directory. The API starts a runner every few minutes and, during a
 * blue/green swap, from two containers at once; on 2026-10-06 two runners overlapped and the learn
 * phase ran while generation was still writing. The lock names the holder's pid and time; a lock
 * whose process is gone, or older than RUNNER_LOCK_STALE_MS, is taken over.
 */
export async function acquireRunnerLock(dir, { pid = process.pid, now = () => new Date(), staleMs = RUNNER_LOCK_STALE_MS, alive = processAlive } = {}) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(dir, 'runner.lock');
  const body = `${JSON.stringify({ pid, at: now().toISOString() })}\n`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(body);
      await handle.close();
      return { path: lockPath, release: () => rm(lockPath, { force: true }) };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    let holder = null;
    try {
      holder = JSON.parse(await readFile(lockPath, 'utf8'));
    } catch {
      holder = null;
    }
    const age = holder?.at ? now().getTime() - Date.parse(holder.at) : Number.POSITIVE_INFINITY;
    const held = Number.isInteger(holder?.pid) && holder.pid !== pid && alive(holder.pid) && age < staleMs;
    if (held) return null;
    await rm(lockPath, { force: true });
  }
  return null;
}

export async function main() {
  let lock = null;
  try {
    const settings = flywheelSettings();
    lock = await acquireRunnerLock(settings.dir);
    if (!lock) {
      console.info('hermes retrieval flywheel reason=already_running');
      process.exitCode = 0;
      return;
    }
    const records = await readStdin();
    await runFlywheelNight({ records, settings });
  } catch {
    console.info('hermes retrieval flywheel reason=runner_failed');
  } finally {
    if (lock) await lock.release().catch(() => {});
  }
  process.exitCode = 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
