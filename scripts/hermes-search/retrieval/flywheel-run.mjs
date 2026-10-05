#!/usr/bin/env node
// Offline run of one retrieval configuration over the synthetic question set, for the gate
// (flywheel-gate.mjs). It answers each kept question with the kiosk's pipeline through
// createLiveScorer, on a copied snapshot, enrichment store, and dense store, and writes one case
// per question: ids, outcome, loss stage, no record text. JEV goes through TypeSafe
// (TYPESAFE_API_KEY) and embedding through the DGX gateway (HERMES_INFERENCE_ORIGIN and
// HERMES_INFERENCE_TOKEN, usually over a tunnel from the Mac).
// Usage: node retrieval/flywheel-run.mjs --snapshot snapshot.json --questions night.jsonl [more]
//   --out run.json [--label name] [--split dev|heldout|all] [--enrichment store.jsonl|off]
//   [--dense store.bin|off] [--learned learned-queries.jsonl|off] [--pool 30] [--limit N]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadNonconformityCatalog } from './catalog.mjs';
import { RUN_SCHEMA, questionSet } from './flywheel-gate.mjs';
import { createLiveScorer } from './flywheel-live.mjs';
import { readLearned } from './flywheel-learn.mjs';
import { bareId } from './flywheel-pairs.mjs';
import { readNightRows } from './flywheel-report.mjs';

export function parseRunArgs(argv) {
  const options = { snapshot: null, questions: [], out: null, label: null, split: 'dev', enrichment: 'off', learned: 'off', dense: 'off', pool: null, limit: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--questions') {
      while (argv[index + 1] && !argv[index + 1].startsWith('--')) options.questions.push(argv[(index += 1)]);
    } else if (arg === '--snapshot') options.snapshot = argv[(index += 1)];
    else if (arg === '--out') options.out = argv[(index += 1)];
    else if (arg === '--label') options.label = argv[(index += 1)];
    else if (arg === '--split') options.split = argv[(index += 1)];
    else if (arg === '--enrichment') options.enrichment = argv[(index += 1)];
    else if (arg === '--learned') {
      options.learned = argv[(index += 1)];
      if (!options.learned || options.learned.startsWith('--')) throw new Error('--learned needs a path or off');
    } else if (arg === '--dense') options.dense = argv[(index += 1)];
    else if (arg === '--pool') options.pool = Number.parseInt(argv[(index += 1)], 10);
    else if (arg === '--limit') options.limit = Number.parseInt(argv[(index += 1)], 10);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.snapshot || !options.questions.length || !options.out) {
    throw new Error('usage: flywheel-run.mjs --snapshot snapshot.json --questions night.jsonl [more] --out run.json');
  }
  if (!['dev', 'heldout', 'all'].includes(options.split)) throw new Error('--split must be dev, heldout, or all');
  return options;
}

/** Environment for createLiveScorer that selects this run's configuration. */
export function scorerEnv(options, base = process.env) {
  const env = {
    HERMES_RETRIEVAL_DENSE_PROVIDER: options.dense === 'off' ? 'off' : 'dgx',
    HERMES_RETRIEVAL_ENRICHMENT_ENABLED: options.enrichment === 'off' ? 'false' : 'true',
    HERMES_FLYWHEEL_LEARNED_ENABLED: 'false',
  };
  if (options.dense !== 'off') {
    env.HERMES_RETRIEVAL_DENSE_STORE = options.dense;
    // A tunnel to the embedding service (HERMES_RETRIEVAL_DENSE_BASE_URL) takes precedence over the
    // gateway, as in denseSettings; the Mac usually reaches the DGX that way.
    if (base.HERMES_RETRIEVAL_DENSE_BASE_URL) env.HERMES_RETRIEVAL_DENSE_BASE_URL = base.HERMES_RETRIEVAL_DENSE_BASE_URL;
    env.HERMES_INFERENCE_ORIGIN = base.HERMES_INFERENCE_ORIGIN ?? '';
    env.HERMES_INFERENCE_TOKEN = base.HERMES_INFERENCE_TOKEN ?? '';
  }
  if (options.enrichment !== 'off') env.HERMES_RETRIEVAL_ENRICHMENT_STORE = options.enrichment;
  if (Number.isInteger(options.pool)) env.HERMES_RETRIEVAL_RELEVANCE_POOL = String(options.pool);
  return env;
}

/**
 * Answers the selected questions one by one. Questions whose anchor is not in the records are
 * skipped, so an older snapshot can still be used. Injectable scorer for tests.
 */
export async function runCases({ questions, records, score, split = 'dev', limit = null, log = () => {} }) {
  const known = new Set(records.map((record) => bareId(record.id)));
  // Real kiosk questions carry a hashed id, not a record id; their relevant records were labelled already.
  const selected = questions.filter((question) => (split === 'all' || question.split === split) && (question.source === 'real' || known.has(question.id)));
  const skipped = questions.filter((question) => (split === 'all' || question.split === split)).length - selected.length;
  const picked = Number.isInteger(limit) && limit > 0 ? selected.slice(0, limit) : selected;
  const cases = [];
  for (const [index, question] of picked.entries()) {
    const live = await score({ a: question.id, b: null, question: question.question, grades: null, relevantIds: question.relevant });
    cases.push({ id: question.id, split: question.split, outcome: live.outcome, shown: live.shown, candidates: live.candidates, loss: live.loss, vectorStatus: live.vectorStatus, ms: live.ms });
    log(`${index + 1}/${picked.length} ${question.id} ${live.outcome} ${live.loss ?? 'shown'} ${live.ms}ms`);
  }
  return { cases, skipped };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseRunArgs(argv);
  const payload = JSON.parse(readFileSync(options.snapshot, 'utf8'));
  const records = Array.isArray(payload) ? payload : payload.records;
  if (!Array.isArray(records)) throw new Error('snapshot records must be an array');
  const rows = options.questions.flatMap((file) => readNightRows(readFileSync(file, 'utf8')));
  const questions = questionSet(rows);
  const { createTypesafeDirectEvaluate } = await import('../hermes-jev-record-pilot.mjs');
  const learned = options.learned === 'off' ? null : (await readLearned(options.learned)).filter((row) => row.state === 'active');
  const score = await createLiveScorer({ records, catalog: loadNonconformityCatalog(), evaluate: createTypesafeDirectEvaluate(), env: scorerEnv(options), learned });
  const started = Date.now();
  const { cases, skipped } = await runCases({ questions, records, score, split: options.split, limit: options.limit, log: (line) => console.error(line) });
  const run = {
    schema: RUN_SCHEMA,
    config: { label: options.label ?? options.out, split: options.split, enrichment: options.enrichment, learned: options.learned, dense: options.dense, pool: options.pool, snapshot: options.snapshot },
    startedAt: new Date(started).toISOString(),
    elapsedMs: Date.now() - started,
    skipped,
    cases,
  };
  writeFileSync(options.out, `${JSON.stringify(run, null, 1)}\n`, { mode: 0o600 });
  const shown = cases.filter((entry) => entry.loss == null).length;
  console.log(`run ${run.config.label}: cases ${cases.length}, relevant shown ${shown}, skipped ${skipped}, ${Math.round(run.elapsedMs / 1000)}s`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
  });
}
