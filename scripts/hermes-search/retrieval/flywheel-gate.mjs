#!/usr/bin/env node
// Acceptance gate for retrieval changes on the synthetic question set
// (hermes-synthetic-question-flywheel-execplan.md, Milestone 4). Kept questions from the night
// files are split into development and held-out by a hash of the anchor id, so the split is fixed
// before anyone reads a question. Two offline runs (flywheel-run.mjs) are compared per question:
// a question counts when a relevant record (the anchor, or the confirmed near miss) is shown.
// A change is accepted when the held-out set shows no significant loss (two-sided sign test over
// the questions where the runs differ) and the development set shows a gain.
// Usage: node retrieval/flywheel-gate.mjs --questions night.jsonl [more] --baseline a.json --candidate b.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relevantIds } from './flywheel-live.mjs';
import { bareId } from './flywheel-pairs.mjs';
import { readNightRows } from './flywheel-report.mjs';

export const DEV_SHARE = 70;
export const ALPHA = 0.05;
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
    if (row?.kept !== true || typeof row.question !== 'string' || !row.question) continue;
    const id = bareId(row.a);
    if (byAnchor.has(id)) continue;
    byAnchor.set(id, { id, question: row.question, split: splitOf(id), relevant: relevantIds(row), seed: row.seed ?? null });
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

/** Per split: how many questions each run answered with a relevant record, and the paired changes. */
export function compareRuns({ questions, baseline, candidate }) {
  const base = casesById(baseline);
  const cand = casesById(candidate);
  const splits = {};
  for (const split of ['dev', 'heldout']) {
    splits[split] = { n: 0, skipped: 0, baselineShown: 0, candidateShown: 0, gained: 0, lost: 0, p: 1, gainedIds: [], lostIds: [] };
  }
  for (const question of questions) {
    const result = splits[question.split];
    const before = relevantShown(base.get(question.id), question.relevant);
    const after = relevantShown(cand.get(question.id), question.relevant);
    if (before == null || after == null) {
      result.skipped += 1;
      continue;
    }
    result.n += 1;
    if (before) result.baselineShown += 1;
    if (after) result.candidateShown += 1;
    if (!before && after) {
      result.gained += 1;
      if (question.split === 'dev') result.gainedIds.push(question.id);
    } else if (before && !after) {
      result.lost += 1;
      if (question.split === 'dev') result.lostIds.push(question.id);
    }
  }
  for (const result of Object.values(splits)) result.p = signTest(result.gained, result.lost);
  return splits;
}

/** The rule: held-out shows no significant loss, development shows a gain. */
export function decide(comparison, { alpha = ALPHA } = {}) {
  const reasons = [];
  const heldout = comparison.heldout;
  const dev = comparison.dev;
  if (heldout.lost > heldout.gained && heldout.p < alpha) {
    reasons.push(`held-out lost ${heldout.lost} and gained ${heldout.gained} (p = ${heldout.p.toFixed(3)})`);
  }
  if (dev.gained <= dev.lost) reasons.push(`development gained ${dev.gained} and lost ${dev.lost}`);
  if (dev.n + heldout.n === 0) reasons.push('no question was answered by both runs');
  return { accept: reasons.length === 0, reasons };
}

export function formatGate(comparison, decision) {
  const line = (name, result) => `  ${name}: n ${result.n}, relevant shown ${result.baselineShown} -> ${result.candidateShown}, gained ${result.gained}, lost ${result.lost}, p ${result.p.toFixed(3)}`
    + (result.skipped ? `, skipped ${result.skipped}` : '');
  const lines = [line('development', comparison.dev), line('held-out', comparison.heldout)];
  if (comparison.dev.gainedIds.length) lines.push(`  development gained: ${comparison.dev.gainedIds.join(', ')}`);
  if (comparison.dev.lostIds.length) lines.push(`  development lost: ${comparison.dev.lostIds.join(', ')}`);
  lines.push(decision.accept ? '  gate: accept' : `  gate: reject (${decision.reasons.join('; ')})`);
  return lines.join('\n');
}

export function parseGateArgs(argv) {
  const options = { questions: [], baseline: null, candidate: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--questions') {
      while (argv[index + 1] && !argv[index + 1].startsWith('--')) options.questions.push(argv[(index += 1)]);
    } else if (arg === '--baseline') options.baseline = argv[(index += 1)];
    else if (arg === '--candidate') options.candidate = argv[(index += 1)];
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.questions.length || !options.baseline || !options.candidate) {
    throw new Error('usage: flywheel-gate.mjs --questions night.jsonl [more] --baseline run.json --candidate run.json');
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseGateArgs(argv);
  const rows = options.questions.flatMap((file) => readNightRows(readFileSync(file, 'utf8')));
  const questions = questionSet(rows);
  const baseline = JSON.parse(readFileSync(options.baseline, 'utf8'));
  const candidate = JSON.parse(readFileSync(options.candidate, 'utf8'));
  const comparison = compareRuns({ questions, baseline, candidate });
  const decision = decide(comparison);
  console.log(`questions ${questions.length} (development ${questions.filter((item) => item.split === 'dev').length}, held-out ${questions.filter((item) => item.split === 'heldout').length})`);
  console.log(`baseline ${baseline.config?.label ?? options.baseline} -> candidate ${candidate.config?.label ?? options.candidate}`);
  console.log(formatGate(comparison, decision));
  process.exitCode = decision.accept ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
