#!/usr/bin/env node
// Offline labels for shown records outside the synthetic question's known relevant set.
// Only ids and grades are persisted; record text is passed to the grader in memory.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogEntries, fieldsWithRole, loadNonconformityCatalog } from './catalog.mjs';
import { bareId } from './flywheel-pairs.mjs';
import { readNightRows } from './flywheel-report.mjs';
import { GRADE_BATCH, gradeBatch, recordText } from './graded-labels.mjs';

/** Pool unique, unlabelled question-record pairs from the shown ids of every run. */
export function collectShownPairs({ questions, runs, labels = {} }) {
  const byId = new Map(questions.map((question) => [bareId(question.id), question]));
  const seen = new Map();
  const pairs = [];
  for (const run of runs) {
    for (const entry of run.cases ?? []) {
      const anchorId = bareId(entry.id);
      const question = byId.get(anchorId);
      if (!question) continue;
      const relevant = new Set(question.relevant.map(bareId));
      if (!seen.has(anchorId)) seen.set(anchorId, new Set());
      for (const shownId of entry.shown ?? []) {
        const recordId = bareId(shownId);
        if (relevant.has(recordId) || labels[anchorId]?.[recordId] != null || seen.get(anchorId).has(recordId)) continue;
        seen.get(anchorId).add(recordId);
        pairs.push({ anchorId, question: question.question, recordId });
      }
    }
  }
  return pairs;
}

export function readShownLabels(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

/** Replace the label file atomically, including when an existing file has looser permissions. */
export function writeShownLabels(filePath, labels) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(labels)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, filePath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Update labels in place; each completed batch can be saved before continuing. */
export async function labelShownPairs({
  pairs, recordsById, bodyFields, fieldLabels = {}, evaluate, labels,
  batchSize = GRADE_BATCH, onBatch = null,
}) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  const groups = new Map();
  for (const pair of pairs) {
    const anchorId = bareId(pair.anchorId);
    const recordId = bareId(pair.recordId);
    if (labels[anchorId]?.[recordId] != null) continue;
    if (!groups.has(anchorId)) groups.set(anchorId, { question: pair.question, ids: new Set() });
    groups.get(anchorId).ids.add(recordId);
  }
  let graded = 0;
  let skipped = 0;
  for (const [anchorId, group] of groups) {
    const items = [];
    for (const id of group.ids) {
      if (!recordsById.has(id)) {
        skipped += 1;
        continue;
      }
      items.push({ id, text: recordText(recordsById.get(id), bodyFields, fieldLabels) });
    }
    for (let index = 0; index < items.length; index += batchSize) {
      const result = await gradeBatch({ evaluate, question: group.question, items: items.slice(index, index + batchSize) });
      labels[anchorId] ??= {};
      Object.assign(labels[anchorId], result);
      graded += Object.keys(result).length;
      if (onBatch) await onBatch(labels);
    }
  }
  return { graded, skipped };
}

export function relevantWithLabels(question, labels) {
  const added = Object.entries(labels[bareId(question.id)] ?? {})
    .filter(([, label]) => label.g === 3)
    .map(([id]) => id);
  return [...new Set([...question.relevant, ...added].map(bareId))];
}

function parseArgs(argv) {
  const options = { questions: [], runs: [], snapshot: null, labels: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--questions' || arg === '--runs') {
      const key = arg.slice(2);
      while (argv[index + 1] && !argv[index + 1].startsWith('--')) options[key].push(argv[(index += 1)]);
    } else if (arg === '--snapshot') options.snapshot = argv[(index += 1)];
    else if (arg === '--labels') options.labels = argv[(index += 1)];
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.questions.length || !options.runs.length || !options.snapshot || !options.labels) {
    throw new Error('usage: flywheel-shown-labels.mjs --questions night.jsonl [more] --runs run.json [more] --snapshot snapshot.json --labels labels.json');
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  // The gate consumes these labels; load its question reader only for the CLI to avoid a cycle.
  const { questionSet } = await import('./flywheel-gate.mjs');
  const rows = options.questions.flatMap((file) => readNightRows(readFileSync(file, 'utf8')));
  const questions = questionSet(rows);
  const runs = options.runs.map((file) => JSON.parse(readFileSync(file, 'utf8')));
  const labels = readShownLabels(options.labels);
  const pairs = collectShownPairs({ questions, runs, labels });
  const snapshot = JSON.parse(readFileSync(options.snapshot, 'utf8'));
  const records = Array.isArray(snapshot) ? snapshot : snapshot.records;
  if (!Array.isArray(records)) throw new Error('snapshot records must be an array');
  const recordsById = new Map(records.map((record) => [bareId(record.id), record]));
  const catalog = loadNonconformityCatalog();
  const bodyFields = fieldsWithRole(catalog, 'body');
  const fieldLabels = Object.fromEntries(catalogEntries(catalog).flatMap((entry) => entry.fields.map((field) => [field.key, field.label])));
  const { createTypesafeDirectEvaluate } = await import('../hermes-jev-record-pilot.mjs');
  let batches = 0;
  console.error(`pending ${pairs.length} pairs`);
  const { graded, skipped } = await labelShownPairs({
    pairs, recordsById, bodyFields, fieldLabels, evaluate: createTypesafeDirectEvaluate(), labels,
    onBatch: (current) => {
      writeShownLabels(options.labels, current);
      console.error(`saved batch ${++batches}`);
    },
  });
  writeShownLabels(options.labels, labels);
  const total = Object.values(labels).reduce((sum, entries) => sum + Object.keys(entries).length, 0);
  console.log(`labelled ${graded} pairs, skipped ${skipped}, now ${total} labels`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
  });
}
