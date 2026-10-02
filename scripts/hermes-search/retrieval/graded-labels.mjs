#!/usr/bin/env node
// Graded relevance labels for pooled candidates. A gold case names a few target records, so
// other valid records count as misses. Pooling the candidates of several runs and grading each
// question-record pair gives a label set that every later run is scored against.
// The label file holds ids and grades only; record text is never written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogEntries, fieldsWithRole, loadNonconformityCatalog } from './catalog.mjs';
import { goldTargetIds, readGold } from './evaluate.mjs';

export const GRADE_BATCH = 12;
export const DEFAULT_POOL_DEPTH = 30;
const BODY_CHAR_LIMIT = 900;
const GRADE_IDS = ['g3', 'g2', 'g1', 'g0'];

// Worded differently from the production relevance judge, so the labels are not the judge's own
// question asked twice. Grade 3 is used as "relevant"; a blind check on 2026-10-02 found grade 2
// too noisy to count.
export const GRADE_CRITERIA = {
  g3: '質問が探している出来事（現象・原因・対策・処置のうち質問が指すもの）が、この記録にそのまま書かれている。言い回しが違っても同じ出来事である。',
  g2: '質問と同じ種類の出来事だが、対象の部品・状況・程度が一部異なる。類似事例として参考になる。',
  g1: '部品名や語は共通するが、起きた出来事は質問が探しているものと別である。',
  g0: '質問が探している出来事と関係がない。',
};

export function bareId(id) {
  return String(id).replace(/^[a-z_]+:/u, '');
}

export function caseKey(setName, caseId) {
  return `${setName}/${caseId}`;
}

/** Candidate and shown ids of one evaluated case, best first. */
export function runCaseIds(runCase) {
  const candidates = Array.isArray(runCase?.candidateIds) ? runCase.candidateIds : [];
  const shown = Array.isArray(runCase?.finalIds) ? runCase.finalIds : (Array.isArray(runCase?.ids) ? runCase.ids : []);
  return { candidates: candidates.map(bareId), shown: shown.map(bareId) };
}

/**
 * Pool per case: the gold targets, every shown record, and the top `depth` candidates of each run.
 * `sets` is [{ name, gold: [case], runs: [{ cases: [...] }] }].
 */
export function buildPools(sets, { depth = DEFAULT_POOL_DEPTH } = {}) {
  const pools = {};
  for (const set of sets) {
    for (const item of set.gold) {
      const ids = [...goldTargetIds(item)];
      for (const run of set.runs) {
        const runCase = (run.cases ?? []).find((entry) => entry.id === item.id);
        if (!runCase) continue;
        const { candidates, shown } = runCaseIds(runCase);
        ids.push(...shown, ...candidates.slice(0, depth));
      }
      pools[caseKey(set.name, item.id)] = { question: item.question, ids: [...new Set(ids)] };
    }
  }
  return pools;
}

export function recordText(record, bodyFields, labels = {}) {
  const parts = [];
  for (const key of bodyFields) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) parts.push(`${labels[key] ?? key}: ${value.trim()}`);
  }
  return parts.join('\n').slice(0, BODY_CHAR_LIMIT);
}

/** One JEV call grades up to GRADE_BATCH records for one question. Returns { id: { g, p } }. */
export async function gradeBatch({ evaluate, question, items }) {
  const questions = {};
  items.forEach((item, index) => {
    questions[`c${index}`] = {
      type: 'choice',
      instructions: `次の不適合記録が、質問が探している出来事にどれだけ当てはまるかを一つ選ぶ。組織名・日付・件数の指定は判断に使わない。\n\n質問:\n${question}\n\n記録:\n${item.text}`,
      criteria: GRADE_CRITERIA,
    };
  });
  const evaluated = await evaluate({
    model: 'typesafe-ai/jev',
    state: { request: question, relatedHistory: [], confirmationPending: null },
    questions,
    maxRetries: 0,
  });
  const answers = evaluated?.answers && typeof evaluated.answers === 'object' ? evaluated.answers : {};
  const graded = {};
  items.forEach((item, index) => {
    const answer = answers[`c${index}`];
    if (!GRADE_IDS.includes(answer?.choice)) return;
    const probabilities = answer.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities : {};
    graded[item.id] = {
      g: Number(answer.choice.slice(1)),
      p: ['g0', 'g1', 'g2', 'g3'].map((id) => Math.round((Number(probabilities[id]) || 0) * 100) / 100),
    };
  });
  return graded;
}

/**
 * Grades every pooled pair that has no label yet. `labels` is updated in place, so a stopped run
 * continues where it left off. `onBatch` is called after each batch for periodic saves.
 */
export async function labelPools({
  pools, labels, recordsById, bodyFields, fieldLabels = {}, evaluate,
  concurrency = 4, retries = 4, onBatch = null, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const jobs = [];
  for (const [key, pool] of Object.entries(pools)) {
    labels[key] ??= {};
    const todo = pool.ids
      .filter((id) => labels[key][id] == null && recordsById.has(id))
      .map((id) => ({ id, text: recordText(recordsById.get(id), bodyFields, fieldLabels) }))
      .filter((item) => item.text);
    for (let index = 0; index < todo.length; index += GRADE_BATCH) {
      jobs.push({ key, question: pool.question, items: todo.slice(index, index + GRADE_BATCH) });
    }
  }
  let done = 0;
  let failed = 0;
  const queue = [...jobs];
  const worker = async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      let graded = null;
      for (let attempt = 0; attempt <= retries && !graded; attempt += 1) {
        try {
          graded = await gradeBatch({ evaluate, question: job.question, items: job.items });
        } catch {
          if (attempt < retries) await sleep(4000 * (attempt + 1));
        }
      }
      if (graded) {
        Object.assign(labels[job.key], graded);
        done += 1;
      } else {
        failed += 1;
      }
      if (onBatch) onBatch({ done, failed, total: jobs.length });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { batches: jobs.length, done, failed };
}

/** `--set name:gold.json:run.json[,run.json...]`, repeated. */
export function parseSetArg(value) {
  const [name, gold, runs] = String(value ?? '').split(':');
  if (!name || !gold || !runs) throw new Error('--set needs name:gold.json:run.json[,run.json...]');
  return { name, gold, runs: runs.split(',').filter(Boolean) };
}

export function loadSets(specs) {
  return specs.map((spec) => ({
    name: spec.name,
    gold: readGold(spec.gold),
    runs: spec.runs.map((file) => JSON.parse(fs.readFileSync(file, 'utf8'))),
  }));
}

function parseArgs(argv) {
  const parsed = { sets: [], snapshot: null, labels: null, depth: DEFAULT_POOL_DEPTH };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--set') parsed.sets.push(parseSetArg(argv[++index]));
    else if (arg === '--snapshot') parsed.snapshot = argv[++index];
    else if (arg === '--labels') parsed.labels = argv[++index];
    else if (arg === '--depth') parsed.depth = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!parsed.sets.length || !parsed.snapshot || !parsed.labels || !Number.isInteger(parsed.depth) || parsed.depth < 1) {
    throw new Error('Usage: node retrieval/graded-labels.mjs --set <name:gold:run[,run]> [--set ...] --snapshot <path> --labels <labels.json> [--depth 30]');
  }
  return parsed;
}

async function main() {
  if (!process.env.TYPESAFE_API_KEY) {
    console.error('TYPESAFE_API_KEY is not set');
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const pools = buildPools(loadSets(args.sets), { depth: args.depth });
  const snapshot = JSON.parse(fs.readFileSync(args.snapshot, 'utf8'));
  const recordsById = new Map(snapshot.records.map((record) => [bareId(record.id), record]));
  const catalog = loadNonconformityCatalog();
  const bodyFields = fieldsWithRole(catalog, 'body');
  const fieldLabels = Object.fromEntries(catalogEntries(catalog).flatMap((entry) => entry.fields.map((field) => [field.key, field.label])));
  const labels = fs.existsSync(args.labels) ? JSON.parse(fs.readFileSync(args.labels, 'utf8')) : {};
  const save = () => {
    fs.mkdirSync(path.dirname(args.labels), { recursive: true, mode: 0o700 });
    fs.writeFileSync(args.labels, `${JSON.stringify(labels)}\n`, { mode: 0o600 });
  };
  const { createTypesafeDirectEvaluate } = await import('../hermes-jev-record-pilot.mjs');
  const result = await labelPools({
    pools,
    labels,
    recordsById,
    bodyFields,
    fieldLabels,
    evaluate: createTypesafeDirectEvaluate(),
    onBatch: ({ done, failed }) => {
      if ((done + failed) % 25 === 0) save();
    },
  });
  save();
  const pairs = Object.values(pools).reduce((sum, pool) => sum + pool.ids.length, 0);
  const labelled = Object.entries(pools).reduce((sum, [key, pool]) => sum + pool.ids.filter((id) => labels[key]?.[id]).length, 0);
  process.stdout.write(`${JSON.stringify({ cases: Object.keys(pools).length, pairs, labelled, ...result })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
