#!/usr/bin/env node
// Acceptance gate for retrieval changes on the synthetic question set
// (hermes-synthetic-question-flywheel-execplan.md, Milestone 4). Kept questions from the night
// files are split into development and held-out by a hash of the anchor id, so the split is fixed
// before anyone reads a question. Two offline runs (flywheel-run.mjs) are compared per question:
// a question counts when a relevant record (the anchor, or the confirmed near miss) is shown.
// A change is accepted when held-out has no net loss and development gains at least MIN_DEV_NET.
// The two-sided sign test over questions where the runs differ is retained for reporting.
// Usage: node retrieval/flywheel-gate.mjs --questions night.jsonl [more] --baseline a.json --candidate b.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relevantIds } from './flywheel-live.mjs';
import { bareId } from './flywheel-pairs.mjs';
import { readNightRows } from './flywheel-report.mjs';
import { readShownLabels, relevantWithLabels } from './flywheel-shown-labels.mjs';

export const DEV_SHARE = 70;
export const ALPHA = 0.05;
export const MIN_DEV_NET = 3;
export const RUN_SCHEMA = 'hermes-flywheel-run/v1';

export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Development or held-out, fixed by the anchor id. The implementing agent reads development only. */
export function splitOf(anchorId) {
  return fnv1a(bareId(anchorId)) % 100 < DEV_SHARE ? 'dev' : 'heldout';
}

/** Kept questions from night rows, one per anchor, with their split and relevant ids. */
export function questionSet(rows) {
  const byAnchor = new Map();
  for (const row of rows) {
    if (row?.source === 'real') {
      if (typeof row.question !== 'string' || !row.question || !row.id || byAnchor.has(row.id)) continue;
      if (row.kind === 'filter') {
        if (row.filterCheck?.supported !== true) continue;
        byAnchor.set(row.id, { id: row.id, question: row.question, split: row.split, relevant: [], seed: null, source: 'real', kind: 'filter', plan: row.live?.plan });
      } else if (row.relevant?.length) {
        byAnchor.set(row.id, { id: row.id, question: row.question, split: row.split, relevant: row.relevant, seed: null, source: 'real', kind: 'content' });
      }
      continue;
    }
    if (row?.kept !== true || typeof row.question !== 'string' || !row.question) continue;
    const id = bareId(row.a);
    if (byAnchor.has(id)) continue;
    byAnchor.set(id, { id, question: row.question, split: splitOf(id), relevant: relevantIds(row), seed: row.seed ?? null, source: 'synthetic', kind: 'content' });
  }
  return [...byAnchor.values()];
}

/** Two-sided exact sign test: probability of a split at least this uneven under equal chances. */
export function signTest(gained, lost) {
  const n = gained + lost;
  if (n === 0) return 1;
  const low = Math.min(gained, lost);
  let tail = 0;
  let coefficient = 1;
  for (let k = 0; k <= low; k += 1) {
    tail += coefficient;
    coefficient = (coefficient * (n - k)) / (k + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

function casesById(run) {
  const cases = Array.isArray(run?.cases) ? run.cases : [];
  return new Map(cases.map((entry) => [bareId(entry.id), entry]));
}

function relevantShown(entry, relevant) {
  if (!entry) return null;
  const wanted = new Set(relevant.map(bareId));
  return (entry.shown ?? []).map(bareId).some((id) => wanted.has(id));
}

function filterCorrect(entry) {
  if (entry?.filterCheck?.ok == null) return null;
  return entry.filterCheck.ok === true;
}

/** Per split: how many questions each run answered with a relevant record, and the paired changes. */
export function compareRuns({ questions, baseline, candidate, labels = null }) {
  const base = casesById(baseline);
  const cand = casesById(candidate);
  const splits = {};
  for (const split of ['dev', 'heldout']) {
    splits[split] = { n: 0, skipped: 0, baselineShown: 0, candidateShown: 0, gained: 0, lost: 0, p: 1, gainedIds: [], lostIds: [] };
  }
  splits.real = { n: 0, skipped: 0, baselineShown: 0, candidateShown: 0, gained: 0, lost: 0, p: 1 };
  for (const question of questions) {
    const result = splits[question.split];
    const results = question.source === 'real' ? [result, splits.real] : [result];
    const relevant = labels == null || question.kind === 'filter' ? question.relevant : relevantWithLabels(question, labels);
    const before = question.kind === 'filter' ? filterCorrect(base.get(question.id)) : relevantShown(base.get(question.id), relevant);
    const after = question.kind === 'filter' ? filterCorrect(cand.get(question.id)) : relevantShown(cand.get(question.id), relevant);
    if (before == null || after == null) {
      for (const entry of results) entry.skipped += 1;
      continue;
    }
    for (const entry of results) {
      entry.n += 1;
      if (before) entry.baselineShown += 1;
      if (after) entry.candidateShown += 1;
      if (!before && after) entry.gained += 1;
      else if (before && !after) entry.lost += 1;
    }
    if (!before && after) {
      if (question.split === 'dev') result.gainedIds.push(question.id);
    } else if (before && !after) {
      if (question.split === 'dev') result.lostIds.push(question.id);
    }
  }
  for (const result of Object.values(splits)) result.p = signTest(result.gained, result.lost);
  return splits;
}

/** The rule: held-out has no net loss, development gains at least minDevNet. */
export function decide(comparison, { alpha = ALPHA, minDevNet = MIN_DEV_NET } = {}) {
  const reasons = [];
  const heldout = comparison.heldout;
  const dev = comparison.dev;
  if (heldout.lost > heldout.gained) {
    reasons.push(`held-out lost ${heldout.lost} and gained ${heldout.gained}`);
  }
  const net = dev.gained - dev.lost;
  if (net < minDevNet) reasons.push(`development net gain ${net} is below ${minDevNet}`);
  if (dev.n + heldout.n === 0) reasons.push('no question was answered by both runs');
  if (comparison.real?.n > 0 && comparison.real.lost > comparison.real.gained) {
    reasons.push(`real questions lost ${comparison.real.lost} and gained ${comparison.real.gained}`);
  }
  return { accept: reasons.length === 0, reasons };
}

export function formatGate(comparison, decision, { note } = {}) {
  const line = (name, result) => `  ${name}: n ${result.n}, relevant shown ${result.baselineShown} -> ${result.candidateShown}, gained ${result.gained}, lost ${result.lost}, p ${result.p.toFixed(3)}`
    + (result.skipped ? `, skipped ${result.skipped}` : '');
  const lines = [line('development', comparison.dev), line('held-out', comparison.heldout)];
  if (comparison.real) lines.push(line('real', comparison.real));
  if (note) lines.unshift(note);
  if (comparison.dev.gainedIds.length) lines.push(`  development gained: ${comparison.dev.gainedIds.join(', ')}`);
  if (comparison.dev.lostIds.length) lines.push(`  development lost: ${comparison.dev.lostIds.join(', ')}`);
  lines.push(decision.accept ? '  gate: accept' : `  gate: reject (${decision.reasons.join('; ')})`);
  return lines.join('\n');
}

export function parseGateArgs(argv) {
  const options = { questions: [], baseline: null, candidate: null, labels: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--questions') {
      while (argv[index + 1] && !argv[index + 1].startsWith('--')) options.questions.push(argv[(index += 1)]);
    } else if (arg === '--baseline') options.baseline = argv[(index += 1)];
    else if (arg === '--candidate') options.candidate = argv[(index += 1)];
    else if (arg === '--labels') {
      options.labels = argv[(index += 1)];
      if (!options.labels || options.labels.startsWith('--')) throw new Error('--labels needs a path');
    }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.questions.length || !options.baseline || !options.candidate) {
    throw new Error('usage: flywheel-gate.mjs --questions night.jsonl [more] --baseline run.json --candidate run.json [--labels labels.json]');
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseGateArgs(argv);
  const rows = options.questions.flatMap((file) => readNightRows(readFileSync(file, 'utf8')));
  const questions = questionSet(rows);
  const baseline = JSON.parse(readFileSync(options.baseline, 'utf8'));
  const candidate = JSON.parse(readFileSync(options.candidate, 'utf8'));
  const labels = options.labels ? readShownLabels(options.labels) : null;
  const comparison = compareRuns({ questions, baseline, candidate, labels });
  const decision = decide(comparison);
  console.log(`questions ${questions.length} (development ${questions.filter((item) => item.split === 'dev').length}, held-out ${questions.filter((item) => item.split === 'heldout').length})`);
  console.log(`baseline ${baseline.config?.label ?? options.baseline} -> candidate ${candidate.config?.label ?? options.candidate}`);
  const note = labels == null ? undefined : `labels: ${options.labels} (${Object.keys(labels).length} questions)`;
  console.log(formatGate(comparison, decision, { note }));
  process.exitCode = decision.accept ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
