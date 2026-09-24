#!/usr/bin/env node
// Local query: validated plan, record ids, original field text, and stage timings.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { digestRecords } from '../hermes-qmd-snapshot-export.mjs';
import { loadNonconformityCatalog } from './catalog.mjs';
import { attachEnrichment, readEnrichmentStores, splitEnrichmentArg } from './enrichment-attach.mjs';
import { execute, openQmdVectorRanker } from './executor.mjs';
import { createPlanner } from './planner-jev.mjs';
import { createRelevanceJudge } from './relevance-jev.mjs';
import { validateQueryPlan } from './query-plan.mjs';
import { buildValueIndex, findCandidateValues } from './value-index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const parsed = {
    snapshot: null, planJson: null, qmdIndex: null, embedModel: null, jevRelevance: null,
    enrichment: [], noEnrichment: false, allowSubset: false, questionParts: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--snapshot') parsed.snapshot = argv[++index];
    else if (arg === '--plan-json') parsed.planJson = argv[++index];
    else if (arg === '--qmd-index') parsed.qmdIndex = argv[++index];
    else if (arg === '--embed-model') parsed.embedModel = argv[++index];
    else if (arg === '--enrichment') parsed.enrichment.push(...splitEnrichmentArg(argv[++index]));
    else if (arg === '--no-enrichment') parsed.noEnrichment = true;
    else if (arg === '--allow-subset') parsed.allowSubset = true;
    else if (arg === '--jev-relevance') {
      const next = argv[index + 1];
      if (next === 'false' || next === 'off') {
        parsed.jevRelevance = false;
        index += 1;
      } else if (next === 'true' || next === 'on') {
        parsed.jevRelevance = true;
        index += 1;
      } else parsed.jevRelevance = true;
    } else if (arg === '--') {
      parsed.questionParts.push(...argv.slice(index + 1));
      break;
    } else parsed.questionParts.push(arg);
  }
  parsed.question = parsed.questionParts.join(' ').trim();
  return parsed;
}

function printUsage() {
  console.error('Usage: node scripts/hermes-search/retrieval/cli.mjs --snapshot <path> [--qmd-index <path>] [--embed-model <path>] [--jev-relevance] [--enrichment <jsonl>] [--no-enrichment] [--allow-subset] [--plan-json \'<json>\'] "<question>"');
}

async function ensurePrivate(kind) {
  const root = path.join(os.homedir(), 'Documents', 'hermes-retrieval-private');
  const dir = path.join(root, kind);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  await fsp.chmod(root, 0o700);
  await fsp.chmod(dir, 0o700);
  return dir;
}

async function resolveQmdRoot() {
  const candidates = [process.env.HERMES_QMD_ROOT, path.resolve(here, '../node_modules/@tobilu/qmd')].filter(Boolean);
  for (const root of candidates) {
    try {
      await fsp.access(path.join(root, 'dist/index.js'));
      return root;
    } catch {
      // Try the next location.
    }
  }
  return null;
}

function relevanceEnabled(flag) {
  if (flag === false) return false;
  if (flag === true) return true;
  return Boolean(process.env.TYPESAFE_API_KEY);
}

function shortReason(error) {
  return String(error?.message ?? error ?? 'vector ranking failed').slice(0, 300);
}

function prepareStatus(reason) {
  if (!reason) return null;
  if (/not set|not found|was not found/u.test(reason)) return 'skipped';
  return 'failed';
}

async function tryOpenVector({ qmdIndex, embedModel, sourceId }) {
  if (!qmdIndex || !embedModel) return { reason: 'qmd index or embed model flag is not set' };
  try {
    await fsp.access(qmdIndex);
  } catch {
    return { reason: 'qmd index was not found' };
  }
  try {
    await fsp.access(embedModel);
  } catch {
    return { reason: 'embed model was not found' };
  }
  const qmdRoot = await resolveQmdRoot();
  if (!qmdRoot) return { reason: 'QMD runtime dist/index.js was not found. Set HERMES_QMD_ROOT.' };
  const started = performance.now();
  try {
    const ranker = await openQmdVectorRanker({
      indexSourcePath: qmdIndex,
      embedModelPath: embedModel,
      workRoot: await ensurePrivate('work'),
      qmdRoot,
      sourceId,
    });
    return { ranker, prepareMs: ranker.prepareMs ?? Math.round(performance.now() - started) };
  } catch (error) {
    return { reason: shortReason(error), prepareMs: Math.round(performance.now() - started) };
  }
}

async function emit(output) {
  const runs = await ensurePrivate('runs');
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  await fsp.writeFile(path.join(runs, `${stamp}.json`), `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.snapshot) {
    printUsage();
    process.exit(1);
  }
  const started = performance.now();
  const payload = JSON.parse(fs.readFileSync(args.snapshot, 'utf8'));
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.records)) throw new Error('snapshot records must be an array');
  if (!args.allowSubset) {
    if (payload.recordCount != null && payload.recordCount !== payload.records.length) {
      throw new Error('snapshot recordCount does not match records length');
    }
    if (typeof payload.digest === 'string' && payload.digest && payload.digest !== digestRecords(payload.records)) {
      throw new Error('snapshot digest does not match canonical records');
    }
  }
  if (!args.noEnrichment && args.enrichment.length) {
    payload.records = attachEnrichment(payload.records, readEnrichmentStores(args.enrichment));
  }
  const catalog = loadNonconformityCatalog();
  const valueIndex = buildValueIndex(payload.records, catalog);
  let submitted = null;
  let planMs = 0;
  let validation;
  if (args.planJson != null) {
    try {
      submitted = JSON.parse(args.planJson);
    } catch {
      console.error('plan-json is not valid JSON');
      process.exit(1);
    }
    const planStarted = performance.now();
    validation = validateQueryPlan(submitted, catalog, valueIndex);
    planMs = Math.round(performance.now() - planStarted);
  } else if (!process.env.TYPESAFE_API_KEY) {
    console.error('TYPESAFE_API_KEY is not set');
    process.exit(1);
  } else {
    if (!args.question) {
      printUsage();
      process.exit(1);
    }
    const candidates = findCandidateValues(args.question, valueIndex, catalog);
    const planned = await createPlanner().plan({
      question: args.question,
      previousPlan: null,
      catalog,
      candidates,
      valueIndex,
    });
    planMs = planned.timings.planMs;
    submitted = planned.plan;
    validation = validateQueryPlan(planned.plan, catalog, valueIndex);
  }
  if (!validation.ok) {
    await emit({
      status: 'clarification',
      plan: submitted,
      clarification: validation.clarification,
      ids: [],
      results: [],
      timings: {
        planMs,
        filterMs: 0,
        lexicalMs: 0,
        vectorMs: null,
        vectorStatus: 'not_requested',
        vectorReason: null,
        vectorPrepareMs: null,
        totalMs: Math.round(performance.now() - started),
      },
    });
    return;
  }
  const plan = validation.plan;
  let vector = null;
  let ranker = null;
  let vectorPrepareMs = null;
  let vectorPrepareReason = null;
  if (plan.semanticQuery.trim()) {
    const opened = await tryOpenVector({
      qmdIndex: args.qmdIndex,
      embedModel: args.embedModel,
      sourceId: catalog.id,
    });
    vectorPrepareMs = opened.prepareMs ?? null;
    vectorPrepareReason = opened.reason ?? null;
    if (opened.ranker) {
      ranker = opened.ranker;
      vector = (query, filteredRecords) => ranker.rank(query, filteredRecords);
    }
  }
  let executed;
  try {
    executed = await execute(plan, {
      records: payload.records,
      vector,
      catalog,
      relevance: relevanceEnabled(args.jevRelevance) ? (input) => createRelevanceJudge().judge(input) : undefined,
      requestStartedAt: started,
    });
  } finally {
    if (ranker) await ranker.close();
  }
  const timings = {
    ...executed.timings,
    planMs,
    vectorPrepareMs,
    totalMs: Math.round(performance.now() - started),
  };
  const status = prepareStatus(vectorPrepareReason);
  if (status) {
    timings.vectorStatus = status;
    timings.vectorReason = vectorPrepareReason;
  }
  await emit({
    status: executed.status,
    insufficient: executed.insufficient,
    requested: executed.requested,
    returned: executed.returned,
    plan,
    clarification: executed.clarification ?? null,
    ids: executed.results.map((result) => result.recordId),
    results: executed.results,
    timings,
  });
}

main().catch((error) => {
  console.error(shortReason(error));
  process.exit(1);
});
