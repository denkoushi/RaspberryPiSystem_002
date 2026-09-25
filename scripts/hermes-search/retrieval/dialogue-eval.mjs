#!/usr/bin/env node
// Multi-turn plan evaluation. Each dialogue is planned turn by turn with the previous
// compact plan, as the worker session does, and each turn's plan is checked against
// slot expectations. Record text is not read or written; outputs hold ids and slots.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { referenceDate } from './period-parse.mjs';
import { createPlanner } from './planner-jev.mjs';
import { findCandidateValues } from './value-index.mjs';
import { compactPlan, loadRetrievalResources } from './worker.mjs';

function filterMap(plan) {
  const map = new Map();
  for (const filter of plan?.filters ?? []) {
    const values = map.get(filter.field) ?? [];
    map.set(filter.field, [...values, ...(filter.values ?? [])]);
  }
  return map;
}

function sameValues(actual = [], expected = []) {
  return actual.length === expected.length && [...actual].sort().join('\u0000') === [...expected].sort().join('\u0000');
}

function sortName(sort) {
  return sort && typeof sort === 'object' ? 'recent' : (sort ?? 'relevance');
}

/**
 * Expectation keys (all optional):
 * - filters: { field: [values] } exact set of filter fields and values
 * - mustHave: { field: [values] } these filters must be present with these values
 * - mustNotHave: [field] these filter fields must be absent
 * - content: true when semanticQuery must be non-empty, false when it must be empty
 * - sort: 'recent' | 'relevance'
 * - limit: number
 */
export function checkTurn(plan, expect = {}) {
  const failures = [];
  const filters = filterMap(plan);
  if (expect.filters) {
    const expectedFields = Object.keys(expect.filters).sort();
    const actualFields = [...filters.keys()].sort();
    const same = expectedFields.join('|') === actualFields.join('|')
      && expectedFields.every((field) => sameValues(filters.get(field), expect.filters[field]));
    if (!same) failures.push('filters');
  }
  for (const [field, values] of Object.entries(expect.mustHave ?? {})) {
    if (!sameValues(filters.get(field), values)) failures.push(`mustHave:${field}`);
  }
  for (const field of expect.mustNotHave ?? []) {
    if (filters.has(field)) failures.push(`mustNotHave:${field}`);
  }
  if (typeof expect.content === 'boolean' && Boolean(plan?.semanticQuery) !== expect.content) failures.push('content');
  if (expect.sort && sortName(plan?.sort) !== expect.sort) failures.push('sort');
  if (Number.isFinite(expect.limit) && plan?.limit !== expect.limit) failures.push('limit');
  return failures;
}

/** A turn passes when any listed expectation passes (anyOf) or the single expectation passes. */
export function scoreTurn(plan, turn) {
  const options = Array.isArray(turn.anyOf) && turn.anyOf.length ? turn.anyOf : [turn.expect ?? {}];
  const results = options.map((expect) => checkTurn(plan, expect));
  const passed = results.some((failures) => failures.length === 0);
  return { passed, failures: passed ? [] : results.reduce((best, item) => (item.length < best.length ? item : best)) };
}

export async function evaluateDialogues({ dialogues, plan }) {
  const results = [];
  for (const dialogue of dialogues) {
    let previousPlan = null;
    const turns = [];
    for (const [index, turn] of dialogue.turns.entries()) {
      const started = performance.now();
      const planned = await plan(turn.question, previousPlan);
      const compact = compactPlan(planned);
      const scored = index === 0 && turn.setup ? { passed: true, failures: [] } : scoreTurn(compact, turn);
      turns.push({
        turn: index + 1,
        setup: Boolean(turn.setup),
        passed: scored.passed,
        failures: scored.failures,
        plan: compact,
        planMs: Math.round(performance.now() - started),
      });
      previousPlan = compact;
    }
    const scoredTurns = turns.filter((item) => !item.setup);
    results.push({ id: dialogue.id, passed: scoredTurns.every((item) => item.passed), turns });
  }
  const scoredTurns = results.flatMap((item) => item.turns.filter((turn) => !turn.setup));
  const failuresBySlot = {};
  for (const turn of scoredTurns) {
    for (const failure of turn.failures) failuresBySlot[failure.split(':')[0]] = (failuresBySlot[failure.split(':')[0]] ?? 0) + 1;
  }
  return {
    summary: {
      dialogues: results.length,
      dialoguesPassed: results.filter((item) => item.passed).length,
      turns: scoredTurns.length,
      turnsPassed: scoredTurns.filter((turn) => turn.passed).length,
      failuresBySlot,
    },
    dialogues: results,
  };
}

function parseArgs(argv) {
  const parsed = { gold: null, snapshot: null, out: null, now: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--gold') parsed.gold = argv[++index];
    else if (arg === '--snapshot') parsed.snapshot = argv[++index];
    else if (arg === '--out') parsed.out = argv[++index];
    else if (arg === '--now') parsed.now = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!parsed.gold || !parsed.snapshot || !parsed.out) {
    throw new Error('Usage: node retrieval/dialogue-eval.mjs --gold <dialogues.json> --snapshot <path> [--now YYYY-MM-DD] --out <file>');
  }
  if (parsed.now != null && !/^\d{4}-\d{2}-\d{2}$/u.test(parsed.now)) throw new Error('--now must be YYYY-MM-DD');
  return parsed;
}

async function main() {
  if (!process.env.TYPESAFE_API_KEY) {
    console.error('TYPESAFE_API_KEY is not set');
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const dialogues = JSON.parse(fs.readFileSync(args.gold, 'utf8'));
  const resources = await loadRetrievalResources({ ...process.env, HERMES_TRIAL_SNAPSHOT_PATH: args.snapshot });
  const planner = createPlanner();
  const now = args.now ? referenceDate(args.now) : null;
  const report = await evaluateDialogues({
    dialogues,
    plan: async (question, previousPlan) => (await planner.plan({
      question,
      previousPlan,
      catalog: resources.catalog,
      candidates: findCandidateValues(question, resources.valueIndex, resources.catalog),
      valueIndex: resources.valueIndex,
      ...(now ? { now } : {}),
    })).plan,
  });
  fs.mkdirSync(path.dirname(args.out), { recursive: true, mode: 0o700 });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report.summary)}\n`);
  for (const dialogue of report.dialogues) {
    for (const turn of dialogue.turns) {
      if (!turn.setup && !turn.passed) process.stdout.write(`${dialogue.id} turn ${turn.turn}: ${turn.failures.join(', ')}\n`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
