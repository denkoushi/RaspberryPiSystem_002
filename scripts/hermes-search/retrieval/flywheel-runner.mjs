// Nightly runner for the synthetic question flywheel (hermes-synthetic-question-flywheel-execplan.md,
// Milestone 3). The API process starts it with the corpus on stdin when HERMES_FLYWHEEL_ENABLED is
// true. Inside the night window it samples contrastive record pairs, has the DGX business LLM
// write one question per pair, grades each question with the DGX business LLM and with JEV, and
// appends one line per question to runtime/flywheel/questions-YYYY-MM-DD.jsonl (Tokyo date).
// Lines hold record ids, the seed, the question, grades, and the keep decision; no record text.
// After generation and grading finish, kept questions without live results are answered by the
// kiosk's own pipeline, recording the shown and judged ids and the loss stage (flywheel-live.mjs).
// A nightly budget caps the questions, and a busy guard stops calling the model when it is slow.
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogEntries, fieldsWithRole, loadNonconformityCatalog } from './catalog.mjs';
import { denseSettings, readDenseStore } from './dense-dgx.mjs';
import { enrichmentSettings, withinWindow } from './enrichment-dgx.mjs';
import { createDgxGrader, createJevPairGrader, filterAndLabel } from './flywheel-filter.mjs';
import { createDgxChat, generateForPairs, guardChat } from './flywheel-generate.mjs';
import { createLiveScorer } from './flywheel-live.mjs';
import { answerableIntents, bareId, bodyText, samplePairs } from './flywheel-pairs.mjs';
import { createRandom, sampleSeed } from './flywheel-seeds.mjs';

export const DEFAULT_FLYWHEEL_DIR = '/app/storage/hermes-search/runtime/flywheel';
export const DEFAULT_MAX_QUESTIONS = 100;
export const MAX_QUESTIONS_CAP = 500;

export function flywheelSettings(env = process.env) {
  const requested = Number.parseInt(env.HERMES_FLYWHEEL_MAX_QUESTIONS ?? '', 10);
  const inference = enrichmentSettings(env);
  return {
    enabled: env.HERMES_FLYWHEEL_ENABLED === 'true',
    maxQuestions: Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_QUESTIONS_CAP) : DEFAULT_MAX_QUESTIONS,
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
    for (const row of await readLines(path.join(dir, name))) if (row?.a) used.add(row.a);
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
  ].join(' ');
}

/**
 * One night pass. Injectable: now, readDense, chat (the raw DGX chat), jevEvaluate, live (the
 * scorer from createLiveScorer), and the random seed. Returns the status that is also written to
 * flywheel-status.json.
 */
export async function runFlywheelNight({
  records,
  settings,
  now = () => new Date(),
  readDense = readDenseStore,
  chat = null,
  jevEvaluate = null,
  live = null,
  seed = null,
  log = (line) => console.info(line),
}) {
  const status = { schema: 'hermes-flywheel-status/v1', reason: 'started', night: null, generated: 0, kept: 0, shown: 0, dropped: 0, dropReasons: {}, lossStages: {}, pendingLive: 0, updatedAt: null };
  const finish = async (reason) => {
    status.reason = reason;
    status.updatedAt = now().toISOString();
    if (settings.dir) {
      await mkdir(settings.dir, { recursive: true, mode: 0o700 });
      await writeJson(path.join(settings.dir, 'flywheel-status.json'), status);
    }
    log(countLine(status));
    return status;
  };
  if (!settings.enabled) return finish('disabled');
  if (!withinWindow(settings.window, now())) return finish('outside_window');
  if (!chat && (!settings.origin || !settings.token)) return finish('not_configured');
  status.night = nightOf(now());
  await mkdir(settings.dir, { recursive: true, mode: 0o700 });
  const filePath = questionsPath(settings.dir, status.night);
  const done = (await readLines(filePath)).length;
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
  if (budget > 0) {
    const random = createRandom(seed ?? Number(status.night.replaceAll('-', '')) + done);
    const pairs = samplePairs({ records: corpus, denseEntries, count: budget, random, exclude: await usedAnchors(settings.dir) });
    if (!pairs.length) reason = 'no_pairs';
    else {
      const guarded = guardChat(chat ?? createDgxChat({ origin: settings.origin, token: settings.token, egress: settings.egress, model: settings.model }));
      const gradeDgx = createDgxGrader(guarded);
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
  const rows = await readLines(filePath);
  let scored = false;
  for (const row of rows) {
    if (row.kept !== true || !row.question || row.live) continue;
    if (!withinWindow(settings.window, now())) break;
    score ??= await createLiveScorer({ records, catalog, evaluate });
    row.live = await score(row);
    scored = true;
  }
  if (scored) {
    const temporary = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 });
    await rename(temporary, filePath);
  }
  for (const row of rows) {
    if (row.kept !== true) continue;
    if (!row.live) status.pendingLive += 1;
    else if (row.live.loss == null) status.shown += 1;
    else status.lossStages[row.live.loss] = (status.lossStages[row.live.loss] ?? 0) + 1;
  }
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

export async function main() {
  try {
    const records = await readStdin();
    await runFlywheelNight({ records, settings: flywheelSettings() });
  } catch {
    console.info('hermes retrieval flywheel reason=runner_failed');
  }
  process.exitCode = 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
