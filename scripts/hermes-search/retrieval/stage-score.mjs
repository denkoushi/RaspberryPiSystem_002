#!/usr/bin/env node
// Score planner slots and candidate lists. Prints ids and rates only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATE_OPS = new Set(['before', 'after', 'between']);

function percentile(values, ratio) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index];
}

function sameSet(left, right) {
  const a = [...(left ?? [])].map(String).sort();
  const b = [...(right ?? [])].map(String).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function planStage(plan, { outOfScope = false, dateField = 'discoveredOn' } = {}) {
  const filters = {};
  let from = null;
  let to = null;
  let sawDate = false;
  for (const filter of plan?.filters ?? []) {
    const values = (filter?.values ?? []).filter((value) => typeof value === 'string');
    const dated = DATE_OPS.has(filter?.op) || (filter?.field === dateField && filter?.op === 'eq');
    if (dated) {
      sawDate = true;
      if (filter.op === 'after') from = values[0] ?? from;
      else if (filter.op === 'before') to = values[0] ?? to;
      else if (filter.op === 'between') {
        const ordered = [...values].sort();
        from = ordered[0] ?? from;
        to = ordered[ordered.length - 1] ?? to;
      } else if (filter.op === 'eq') {
        from = values[0] ?? from;
        to = values[0] ?? to;
      }
      continue;
    }
    if (typeof filter?.field !== 'string') continue;
    const bucket = filters[filter.field] ?? [];
    for (const value of values) if (!bucket.includes(value)) bucket.push(value);
    filters[filter.field] = bucket;
  }
  for (const field of Object.keys(filters)) filters[field].sort();
  const sort = plan?.sort;
  const sortRecent = Boolean(sort && sort !== 'relevance' && sort.field === dateField && sort.direction === 'desc');
  const limit = plan?.diagnostics?.limitExplicit === false
    ? null
    : (Number.isInteger(plan?.limit) ? plan.limit : null);
  return {
    outOfScope: Boolean(outOfScope || plan?.diagnostics?.scope === 'out_of_scope'),
    filters,
    date: sawDate ? { from, to } : null,
    sortRecent,
    limit,
    hasContent: plan?.diagnostics?.contentDecision?.final === true,
  };
}

function dateEqual(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.from === right.from && left.to === right.to;
}

function filtersEqual(left, right) {
  const a = left ?? {};
  const b = right ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (!sameSet(a[key], b[key])) return false;
  return true;
}

export function slotMatches(actual, expected) {
  return {
    outOfScope: actual?.outOfScope === expected?.outOfScope,
    filters: filtersEqual(actual?.filters, expected?.filters),
    date: dateEqual(actual?.date, expected?.date),
    sortRecent: actual?.sortRecent === expected?.sortRecent,
    limit: actual?.limit === expected?.limit,
    hasContent: actual?.hasContent === expected?.hasContent,
  };
}

function rate(hits, total) {
  return total ? hits / total : null;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function scoreCases(gold, cases) {
  const byId = new Map((cases ?? []).map((item) => [item.id, item]));
  const rows = [];
  for (const item of gold ?? []) {
    const run = byId.get(item.id) ?? {};
    const slots = slotMatches(run.stage, item.slots);
    const targets = Array.isArray(item.targetIds) ? item.targetIds : [];
    const candidates = Array.isArray(run.candidateIds) ? run.candidateIds : [];
    const finals = Array.isArray(run.finalIds) ? run.finalIds : (Array.isArray(run.ids) ? run.ids : []);
    const targetSet = new Set(targets);
    const hitAt = (limit) => targets.length > 0 && candidates.slice(0, limit).some((id) => targetSet.has(id));
    const filterCase = item.slots && Object.keys(item.slots.filters ?? {}).length > 0;
    const precision = filterCase && item.targetAll !== false
      ? (finals.length ? finals.filter((id) => targetSet.has(id)).length / finals.length : 0)
      : null;
    rows.push({
      id: item.id,
      category: item.category ?? 'uncategorized',
      slots,
      allSlots: Object.values(slots).every(Boolean),
      statusCorrect: run.status === item.expect,
      recall15: targets.length ? hitAt(15) : null,
      recall50: targets.length ? hitAt(50) : null,
      precision,
      finalHit: targets.length ? finals.some((id) => targetSet.has(id)) : null,
      returned: Number.isFinite(run.returned) ? run.returned : finals.length,
      totalMs: Number.isFinite(run.totalMs) ? run.totalMs : null,
    });
  }
  return rows;
}

function summarize(rows) {
  const slotKeys = ['outOfScope', 'filters', 'date', 'sortRecent', 'limit', 'hasContent'];
  const slots = {};
  for (const key of slotKeys) slots[key] = rate(rows.filter((row) => row.slots[key]).length, rows.length);
  const recall = (key) => {
    const scored = rows.filter((row) => row[key] != null);
    return rate(scored.filter((row) => row[key]).length, scored.length);
  };
  const precisions = rows.map((row) => row.precision).filter((value) => value != null);
  const hits = rows.filter((row) => row.finalHit != null);
  return {
    n: rows.length,
    slots,
    allSlots: rate(rows.filter((row) => row.allSlots).length, rows.length),
    status: rate(rows.filter((row) => row.statusCorrect).length, rows.length),
    recall15: recall('recall15'),
    recall50: recall('recall50'),
    precision: mean(precisions),
    finalHit: rate(hits.filter((row) => row.finalHit).length, hits.length),
    returned: mean(rows.map((row) => row.returned)),
    p50: percentile(rows.map((row) => row.totalMs), 0.5),
    p95: percentile(rows.map((row) => row.totalMs), 0.95),
  };
}

export function scoreRun(gold, run) {
  const rows = scoreCases(gold, run?.cases ?? run?.details ?? []);
  const categories = {};
  for (const row of rows) {
    const bucket = categories[row.category] ?? [];
    bucket.push(row);
    categories[row.category] = bucket;
  }
  return {
    all: summarize(rows),
    categories: Object.fromEntries(Object.entries(categories).map(([key, bucket]) => [key, summarize(bucket)])),
  };
}

function fmt(value) {
  if (value == null || Number.isNaN(value)) return '-';
  if (typeof value === 'number') return value.toFixed(2);
  return String(value);
}

export function formatScoreTable(label, scored) {
  const lines = [`run=${label}`];
  const header = 'category n oos filters date sort limit content allSlots status r15 r50 prec hit ret p50 p95';
  lines.push(header);
  const emit = (name, row) => lines.push([
    name, row.n,
    fmt(row.slots.outOfScope), fmt(row.slots.filters), fmt(row.slots.date), fmt(row.slots.sortRecent),
    fmt(row.slots.limit), fmt(row.slots.hasContent), fmt(row.allSlots), fmt(row.status),
    fmt(row.recall15), fmt(row.recall50), fmt(row.precision), fmt(row.finalHit), fmt(row.returned),
    fmt(row.p50), fmt(row.p95),
  ].join(' '));
  emit('all', scored.all);
  for (const [name, row] of Object.entries(scored.categories)) emit(name, row);
  return lines.join('\n');
}

function parseArgs(argv) {
  const parsed = { gold: null, runs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--gold') parsed.gold = argv[++index];
    else if (arg === '--run') parsed.runs.push(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!parsed.gold || !parsed.runs.length) {
    throw new Error('Usage: node retrieval/stage-score.mjs --gold <file> --run <evaluate out> [--run ...]');
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const gold = JSON.parse(fs.readFileSync(args.gold, 'utf8'));
  for (const runPath of args.runs) {
    const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
    process.stdout.write(`${formatScoreTable(path.basename(runPath), scoreRun(gold, run))}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(String(error?.message ?? error).slice(0, 300));
    process.exit(1);
  }
}
