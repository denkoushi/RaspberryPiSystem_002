#!/usr/bin/env node
// One-process gold evaluation. Record text stays out of the summary and the --out file.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { digestRecords } from '../hermes-qmd-snapshot-export.mjs';
import { fieldsWithRole, loadNonconformityCatalog } from './catalog.mjs';
import { attachEnrichment, readEnrichmentStores, splitEnrichmentArg } from './enrichment-attach.mjs';
import { execute, openQmdVectorRanker, recordPassage } from './executor.mjs';
import { createDenseRanker, createScopedDenseRanker } from './dense-index.mjs';
import { planStage } from './stage-score.mjs';
import { linkEntities } from './entity-link.mjs';
import { createPlanner } from './planner-jev.mjs';
import { createRelevanceJudge, candidateBody } from './relevance-jev.mjs';
import { validateQueryPlan } from './query-plan.mjs';
import { buildValueIndex, findCandidateValues } from './value-index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export function percentile(values, ratio) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index];
}

export function countKeywordHits(results, keywords, bodyFields) {
  const needles = keywords.filter((keyword) => typeof keyword === 'string' && keyword);
  let hits = 0;
  for (const result of results ?? []) {
    const text = bodyFields.map((key) => result?.fields?.[key] ?? '').join('\n');
    if (needles.some((keyword) => text.includes(keyword))) hits += 1;
  }
  return hits;
}

export function parseArgs(argv) {
  const parsed = {
    gold: null, snapshot: null, qmdIndex: null, embedModel: null, out: null, jevRelevance: null,
    variant: 'a', entityLink: false, rerankMode: 'replace',
    enrichment: [], noEnrichment: false, allowSubset: false,
    stageDump: false, retriever: 'lexical', now: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--gold') parsed.gold = argv[++index];
    else if (arg === '--snapshot') parsed.snapshot = argv[++index];
    else if (arg === '--qmd-index') parsed.qmdIndex = argv[++index];
    else if (arg === '--embed-model') parsed.embedModel = argv[++index];
    else if (arg === '--enrichment') parsed.enrichment.push(...splitEnrichmentArg(argv[++index]));
    else if (arg === '--no-enrichment') parsed.noEnrichment = true;
    else if (arg === '--allow-subset') parsed.allowSubset = true;
    else if (arg === '--stage-dump') parsed.stageDump = true;
    else if (arg === '--retriever') parsed.retriever = argv[++index];
    else if (arg === '--now') parsed.now = argv[++index];
    else if (arg === '--out') parsed.out = argv[++index];
    else if (arg === '--variant') parsed.variant = argv[++index];
    else if (arg === '--entity-link') parsed.entityLink = true;
    else if (arg === '--rerank-mode') parsed.rerankMode = argv[++index];
    else if (arg === '--jev-relevance') {
      const next = argv[index + 1];
      if (next === 'false' || next === 'off') {
        parsed.jevRelevance = false;
        index += 1;
      } else if (next === 'true' || next === 'on') {
        parsed.jevRelevance = true;
        index += 1;
      } else parsed.jevRelevance = true;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (parsed.now != null && !/^\d{4}-\d{2}-\d{2}$/u.test(parsed.now)) throw new Error('--now must be YYYY-MM-DD');
  if (!parsed.gold || !parsed.snapshot || !parsed.out) {
    throw new Error('Usage: node retrieval/evaluate.mjs --gold <file> --snapshot <path> [--variant a|b|c] [--retriever lexical|dense|hybrid] [--stage-dump] [--now YYYY-MM-DD] [--entity-link] [--rerank-mode replace|gate] [--jev-relevance] [--enrichment <jsonl>] [--no-enrichment] [--allow-subset] --out <file>');
  }
  return parsed;
}

export async function loadHashedDenseRows({ records, bodyFields, embed, modelId, cacheRoot, passageExtra = { prefix: 'passage: ' } }) {
  const hash = createHash('sha256');
  hash.update(String(modelId));
  const passages = [];
  for (const record of records) {
    const text = recordPassage(record, bodyFields);
    passages.push(text);
    hash.update('\n');
    hash.update(String(record.id ?? ''));
    hash.update('\n');
    hash.update(text);
  }
  const digest = hash.digest('hex');
  const safeModel = String(modelId).replace(/[^\w.-]+/gu, '_');
  const cachePath = path.join(cacheRoot, `dense-${safeModel}-${digest}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (cached.digest === digest && Array.isArray(cached.rows) && cached.rows.length === records.length) {
      return { rows: cached.rows, buildMs: 0 };
    }
  } catch {
    // Rebuild when the private cache is missing or unreadable.
  }
  const started = performance.now();
  const vectors = await embed(passages, passageExtra);
  const buildMs = Math.round(performance.now() - started);
  const rows = records.map((record, index) => ({ id: record.id, vector: vectors[index] }));
  await fsp.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  await fsp.writeFile(cachePath, JSON.stringify({ digest, rows }), { mode: 0o600 });
  return { rows, buildMs };
}

function latencyPair(values) {
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
}

function relevanceEnabled(flag) {
  if (flag === false) return false;
  if (flag === true) return true;
  return Boolean(process.env.TYPESAFE_API_KEY);
}

function readGold(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('gold file must be a non-empty array');
  return parsed.map((item, index) => {
    if (!item || typeof item.id !== 'string' || !item.id) throw new Error(`gold case ${index} needs an id`);
    if (typeof item.question !== 'string' || !item.question.trim()) throw new Error(`gold case ${item.id} needs a question`);
    if (!['answer', 'no_result', 'clarification', 'out_of_scope'].includes(item.expect)) throw new Error(`gold case ${item.id} has an unknown expect`);
    if (!Array.isArray(item.judge?.anyOf) || item.judge.anyOf.some((keyword) => typeof keyword !== 'string' || !keyword)) {
      throw new Error(`gold case ${item.id} needs judge.anyOf strings`);
    }
    if (item.filterField != null && typeof item.filterField !== 'string') throw new Error(`gold case ${item.id} has a bad filterField`);
    return item;
  });
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

export function assertSnapshotIdentity(payload) {
  if (payload.recordCount != null && payload.recordCount !== payload.records.length) {
    throw new Error('snapshot recordCount does not match records length');
  }
  if (typeof payload.digest === 'string' && payload.digest && payload.digest !== digestRecords(payload.records)) {
    throw new Error('snapshot digest does not match canonical records');
  }
}

function casePrecision(expect, hits, returned) {
  if (returned === 0) return expect === 'no_result' ? 1 : 0;
  return hits / returned;
}

function allRelevant(expect, hits, returned) {
  if (hits !== returned) return false;
  if (expect === 'answer') return returned > 0;
  return returned === 0;
}

export async function evaluateGold(options) {
  const gold = readGold(options.goldPath);
  const payload = JSON.parse(fs.readFileSync(options.snapshotPath, 'utf8'));
  if (!Array.isArray(payload?.records)) throw new Error('snapshot records must be an array');
  if (!options.allowSubset) assertSnapshotIdentity(payload);
  if (!options.noEnrichment && options.enrichmentPaths?.length) {
    payload.records = attachEnrichment(payload.records, readEnrichmentStores(options.enrichmentPaths));
  }
  const catalog = loadNonconformityCatalog();
  const valueIndex = buildValueIndex(payload.records, catalog);
  const bodyFields = fieldsWithRole(catalog, 'body');
  const variant = options.variant ?? 'a';
  if (!['a', 'b', 'c'].includes(variant)) throw new Error('variant must be a, b, or c');
  const retriever = options.retriever ?? 'lexical';
  if (!['lexical', 'dense', 'hybrid'].includes(retriever)) throw new Error('retriever must be lexical, dense, or hybrid');
  const useDense = variant === 'b' || variant === 'c';
  const dateField = fieldsWithRole(catalog, 'date')[0] ?? 'discoveredOn';
  const denseProvider = options.denseProvider ?? process.env.HERMES_RETRIEVAL_DENSE_PROVIDER ?? 'off';
  const useDgx = denseProvider === 'dgx';
  const needsOnnx = !useDgx && (options.entityLink || useDense || retriever !== 'lexical') && !options.embed;
  const onnx = needsOnnx ? await import('./embed-runtime.mjs') : null;
  const embedder = onnx ? await onnx.createOnnxEmbedder({ modelId: options.embedModelId }) : null;
  let dgxEmbedder = null;
  if (useDgx && !options.embed && (useDense || retriever !== 'lexical')) {
    const baseUrl = options.denseBaseUrl ?? process.env.HERMES_RETRIEVAL_DENSE_BASE_URL;
    if (!baseUrl) throw new Error('dgx dense evaluation requires HERMES_RETRIEVAL_DENSE_BASE_URL');
    const { createDgxEmbedder } = await import('./dense-dgx.mjs');
    dgxEmbedder = createDgxEmbedder({
      baseUrl,
      token: process.env.HERMES_INFERENCE_TOKEN || '',
      timeoutMs: 10_000,
    });
  }
  const embed = options.embed ?? (dgxEmbedder ? (texts, extra) => dgxEmbedder.embed(texts, extra) : (embedder ? (texts, extra) => embedder.embed(texts, extra) : null));
  const passageExtra = useDgx ? { role: 'document' } : { prefix: 'passage: ' };
  const queryExtra = useDgx ? { role: 'query' } : { prefix: 'query: ' };
  const memo = new Map();
  const cachedEmbed = embed
    ? async (texts, extra) => {
      const prefix = extra?.prefix ?? '';
      const missing = [];
      for (const text of texts) if (!memo.has(prefix + text)) missing.push(text);
      if (missing.length) {
        const fresh = await embed(missing, extra);
        missing.forEach((text, index) => memo.set(prefix + text, fresh[index]));
      }
      return texts.map((text) => memo.get(prefix + text));
    }
    : null;
  let denseRank = null;
  if (useDense) {
    const cachePath = path.join(options.workRoot ?? path.join(process.env.HOME, 'Documents', 'hermes-retrieval-private', 'work'), `dense-${embedder?.modelId ?? 'custom'}.json`);
    let rows = null;
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached.count === payload.records.length && cached.rows?.length === payload.records.length) rows = cached.rows;
    } catch { rows = null; }
    if (!rows) {
      const texts = payload.records.map((record) => bodyFields.map((key) => record?.[key] ?? '').join('\n').slice(0, 500));
      const vectors = await cachedEmbed(texts, passageExtra);
      rows = payload.records.map((record, index) => ({ id: record.id, vector: vectors[index] }));
      await fsp.mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
      await fsp.writeFile(cachePath, JSON.stringify({ count: rows.length, rows }), { mode: 0o600 });
    }
    denseRank = createDenseRanker(rows, (queries) => cachedEmbed(queries, queryExtra));
  }
  const reranker = variant === 'c' && !options.rerank
    ? await onnx.createOnnxReranker({ modelId: options.rerankModelId })
    : null;
  const rerank = options.rerank ?? (reranker
    ? async ({ semanticQuery, candidates, bodyFields: fields }) => {
      const pairs = candidates.map((item) => [semanticQuery, candidateBody(item.record, fields)]);
      const scores = await reranker.scorePairs(pairs);
      return { ranked: candidates.map((item, index) => ({ id: item.id, score: scores[index] })) };
    }
    : null);
  let retrieverDense = null;
  let denseBuildMs = null;
  let queryEmbedMs = null;
  if (retriever !== 'lexical') {
    if (!cachedEmbed) throw new Error('dense retriever requires an embedder');
    const workRoot = options.workRoot ?? path.join(process.env.HOME, 'Documents', 'hermes-retrieval-private', 'work');
    const modelId = dgxEmbedder?.modelId ?? embedder?.modelId ?? options.embedModelId ?? 'custom';
    const built = await loadHashedDenseRows({
      records: payload.records,
      bodyFields,
      embed: cachedEmbed,
      modelId,
      cacheRoot: path.join(workRoot, 'dense-cache'),
      passageExtra,
    });
    denseBuildMs = built.buildMs;
    const probeStarted = performance.now();
    await cachedEmbed(['qxprobe'], queryExtra);
    queryEmbedMs = Math.round(performance.now() - probeStarted);
    retrieverDense = createScopedDenseRanker(built.rows, (queries) => cachedEmbed(queries, queryExtra), 50);
  }
  const vector = denseRank
    ? (query) => denseRank(query)
    : null;
  let ranker = null;
  let vectorPrepareReason = null;
  if (!denseRank && options.qmdIndex && options.embedModel) {
    const qmdRoot = await resolveQmdRoot();
    if (!qmdRoot) vectorPrepareReason = 'QMD runtime dist/index.js was not found. Set HERMES_QMD_ROOT.';
    else {
      try {
        ranker = await openQmdVectorRanker({
          indexSourcePath: options.qmdIndex,
          embedModelPath: options.embedModel,
          workRoot: options.workRoot,
          qmdRoot,
          sourceId: catalog.id,
        });
      } catch (error) {
        vectorPrepareReason = String(error?.message ?? error).slice(0, 300);
      }
    }
  } else if (!denseRank) {
    vectorPrepareReason = 'qmd index or embed model flag is not set';
  }
  const activeVector = retrieverDense
    ?? vector
    ?? (ranker ? (query, filteredRecords) => ranker.rank(query, filteredRecords) : null);
  const details = [];
  try {
    for (const item of gold) {
      const wallStarted = performance.now();
      const candidates = findCandidateValues(item.question, valueIndex, catalog);
      const choiceGroups = options.entityLink
        ? await linkEntities({
          question: item.question,
          valueIndex,
          catalog,
          embed: (texts) => cachedEmbed(texts, queryExtra),
        })
        : null;
      const planned = await createPlanner().plan({
        question: item.question,
        previousPlan: null,
        catalog,
        candidates,
        valueIndex,
        choiceGroups,
        now: options.now,
      });
      const validation = planned.plan?.diagnostics?.scope === 'out_of_scope'
        ? { ok: false, outOfScope: true }
        : validateQueryPlan(planned.plan, catalog, valueIndex);
      let executed;
      if (validation.outOfScope) {
        executed = {
          status: 'out_of_scope',
          results: [],
          insufficient: false,
          requested: null,
          returned: 0,
          timings: { totalMs: 0, vectorMs: null, vectorStatus: 'not_requested', vectorReason: null },
        };
      } else if (!validation.ok) {
        executed = {
          status: 'clarification',
          results: [],
          insufficient: false,
          requested: null,
          returned: 0,
          timings: { totalMs: 0, vectorMs: null, vectorStatus: 'not_requested', vectorReason: null },
        };
      } else {
        executed = await execute(validation.plan, {
          records: payload.records,
          vector: activeVector,
          catalog,
          relevance: options.relevance,
          rerank,
          rerankMode: variant === 'c' ? (options.rerankMode ?? 'replace') : null,
          retriever,
          stageDump: Boolean(options.stageDump),
          requestStartedAt: wallStarted,
        });
        if (!activeVector && validation.plan.semanticQuery.trim() && vectorPrepareReason) {
          executed.timings.vectorStatus = /not set|not found|was not found/u.test(vectorPrepareReason) ? 'skipped' : 'failed';
          executed.timings.vectorReason = vectorPrepareReason;
        }
      }
      const hits = countKeywordHits(executed.results, item.judge.anyOf, bodyFields);
      const returned = executed.returned ?? executed.results.length;
      const planFilters = validation.ok ? validation.plan.filters : (planned.plan?.filters ?? []);
      const filterBlob = planFilters.flatMap((filter) => filter.values ?? []).join('\n');
      const filterIncludes = Array.isArray(item.filterIncludes) ? item.filterIncludes : null;
      const filterIncludesOk = filterIncludes
        ? filterIncludes.every((part) => typeof part === 'string' && filterBlob.includes(part))
        : null;
      let precision = item.expect === 'out_of_scope'
        ? (executed.status === 'out_of_scope' && returned === 0 ? 1 : 0)
        : item.expect === 'clarification'
          ? (executed.status === 'clarification' && returned === 0 ? 1 : 0)
          : casePrecision(item.expect, hits, returned);
      if (item.expect === 'answer' && filterIncludesOk && executed.status === 'answer' && returned > 0) precision = 1;
      details.push({
        id: item.id,
        status: executed.status,
        expect: item.expect,
        statusCorrect: executed.status === item.expect,
        hits,
        returned,
        requested: executed.requested ?? null,
        insufficient: Boolean(executed.insufficient),
        precision,
        allRelevant: item.expect === 'out_of_scope'
          ? executed.status === 'out_of_scope' && returned === 0
          : allRelevant(item.expect, hits, returned),
        category: typeof item.category === 'string' ? item.category : null,
        filterField: item.filterField ?? null,
        filterApplied: item.filterField ? planFilters.some((filter) => filter.field === item.filterField) : null,
        filterIncludesOk,
        ids: executed.results.map((result) => result.recordId),
        planMs: planned.timings?.planMs ?? null,
        retrieveMs: executed.timings?.totalMs ?? null,
        vectorMs: executed.timings?.vectorMs ?? null,
        relevanceMs: executed.timings?.relevanceMs ?? null,
        vectorStatus: executed.timings?.vectorStatus ?? null,
        totalMs: Math.round(performance.now() - wallStarted),
        ...(options.stageDump ? {
          stage: planStage(planned.plan, { outOfScope: Boolean(validation.outOfScope), dateField }),
          candidateIds: executed.candidateIds ?? [],
          finalIds: executed.results.map((result) => result.recordId),
          timings: {
            planMs: planned.timings?.planMs ?? null,
            retrieveMs: executed.timings?.totalMs ?? null,
            vectorMs: executed.timings?.vectorMs ?? null,
            relevanceMs: executed.timings?.relevanceMs ?? null,
            totalMs: Math.round(performance.now() - wallStarted),
          },
        } : {}),
      });
    }
  } finally {
    if (ranker) await ranker.close();
  }
  const summary = {
    cases: details.length,
    ...(retriever !== 'lexical' ? { retriever, denseBuildMs, queryEmbedMs } : {}),
    precisionAvg: details.length ? details.reduce((sum, item) => sum + item.precision, 0) / details.length : 0,
    casesAllRelevant: details.filter((item) => item.allRelevant).length,
    statusCorrect: details.filter((item) => item.statusCorrect).length,
    latency: {
      plan: latencyPair(details.map((item) => item.planMs)),
      retrieve: latencyPair(details.map((item) => item.retrieveMs)),
      total: latencyPair(details.map((item) => item.totalMs)),
      cold: details[0]
        ? {
          plan: details[0].planMs,
          retrieve: details[0].retrieveMs,
          total: details[0].totalMs,
          vector: details[0].vectorMs,
          relevance: details[0].relevanceMs,
        }
        : null,
      warm: {
        plan: latencyPair(details.slice(1).map((item) => item.planMs)),
        retrieve: latencyPair(details.slice(1).map((item) => item.retrieveMs)),
        total: latencyPair(details.slice(1).map((item) => item.totalMs)),
        vector: latencyPair(details.slice(1).map((item) => item.vectorMs)),
        relevance: latencyPair(details.slice(1).map((item) => item.relevanceMs)),
      },
    },
    hitRatios: details.map((item) => ({
      id: item.id,
      status: item.status,
      expect: item.expect,
      statusCorrect: item.statusCorrect,
      hits: item.hits,
      returned: item.returned,
      ratio: item.returned ? `${item.hits}/${item.returned}` : `${item.hits}/0`,
      relevanceMs: item.relevanceMs,
    })),
  };
  return { summary, details };
}

async function main() {
  if (!process.env.TYPESAFE_API_KEY) {
    console.error('TYPESAFE_API_KEY is not set');
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const workRoot = path.join(process.env.HOME, 'Documents', 'hermes-retrieval-private', 'work');
  const { summary, details } = await evaluateGold({
    goldPath: args.gold,
    snapshotPath: args.snapshot,
    qmdIndex: args.qmdIndex,
    embedModel: args.embedModel,
    workRoot,
    relevance: relevanceEnabled(args.jevRelevance) ? (input) => createRelevanceJudge().judge(input) : undefined,
    variant: args.variant,
    entityLink: args.entityLink,
    rerankMode: args.rerankMode,
    enrichmentPaths: args.noEnrichment ? [] : args.enrichment,
    noEnrichment: args.noEnrichment,
    allowSubset: args.allowSubset,
    stageDump: args.stageDump,
    retriever: args.retriever,
    now: args.now,
    embedModelId: 'Xenova/multilingual-e5-base',
    rerankModelId: 'Xenova/bge-reranker-base',
  });
  await fsp.mkdir(path.dirname(args.out), { recursive: true, mode: 0o700 });
  await fsp.writeFile(args.out, `${JSON.stringify({ summary, cases: details }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.message ?? error).slice(0, 300));
    process.exit(1);
  });
}
