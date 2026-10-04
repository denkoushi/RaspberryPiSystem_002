#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { fieldsWithRole, loadNonconformityCatalog } from '../catalog.mjs';
import { readGold } from '../evaluate.mjs';
import { buildLexicalIndex } from '../executor.mjs';
import { caseKey } from '../graded-labels.mjs';

const METHODS = ['bm25', 'trgm', 'trgmWord'];
const USAGE = 'node retrieval/prototypes/pg-trgm-recall.mjs --gold <file> [--gold <file>] --labels <file> --snapshot <file> --pg <connection> --out <json>';

// executor.mjs's private scoreDocument rules, without changing its exports.
// Keep token averages, single Han/Katakana terms, k1=1.2, b=0.75 and ID ties.
export function rankBm25(records, bodyFields, question) {
  const index = buildLexicalIndex(records, bodyFields, question);
  const weight = (doc, term) => {
    const tf = doc.counts.get(term) ?? 0;
    const idf = index.idf.get(term) ?? 0;
    if (!tf || !idf) return 0;
    return idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (doc.length / (index.avgLength || 1)))));
  };
  const rows = records.map((record) => {
    const doc = index.documents.get(record.id);
    let score = 0;
    for (const token of index.tokens) {
      if (index.quietTokens.has(token)) continue;
      const grams = [];
      for (let i = 0; i < token.length - 1; i += 1) grams.push(token.slice(i, i + 2));
      if (grams.length) score += grams.reduce((sum, gram) => sum + weight(doc, gram), 0) / grams.length;
      const unigram = /^[\p{Script=Han}\p{Script=Katakana}]$/u.test(token) || /^[\p{Script=Katakana}ー]+$/u.test(token);
      if (unigram && token.length !== 2) score += weight(doc, token);
    }
    return { id: record.id, score };
  });
  rows.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  return rows.slice(0, 200).map((row) => String(row.id));
}

export function scoreCandidates(ids, labels) {
  return {
    top30: ids.slice(0, 30).some((id) => labels[id]?.g === 3),
    top200: ids.some((id) => labels[id]?.g === 3),
    unlabeled200: ids.filter((id) => labels[id]?.g == null).length,
  };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
}

function summarize(cases) {
  return Object.fromEntries(METHODS.map((method) => {
    const hits = (depth) => cases.filter((item) => item[method][depth]).length;
    return [method, {
      cases: cases.length,
      top30: { hits: hits('top30'), rate: cases.length ? hits('top30') / cases.length : null },
      top200: { hits: hits('top200'), rate: cases.length ? hits('top200') / cases.length : null },
      unlabeled200: cases.reduce((sum, item) => sum + item[method].unlabeled200, 0),
      p50Ms: percentile(cases.map((item) => item.ms[method]), 0.5),
      p95Ms: percentile(cases.map((item) => item.ms[method]), 0.95),
    }];
  }));
}

function parseArgs(argv) {
  const args = { gold: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].slice(2);
    if (!argv[i].startsWith('--') || !['gold', 'labels', 'snapshot', 'pg', 'out'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(USAGE);
    if (key === 'gold') args.gold.push(argv[++i]);
    else args[key] = argv[++i];
  }
  if (!args.gold.length || !args.labels || !args.snapshot || !args.pg || !args.out) throw new Error(USAGE);
  if (args.gold.some((file) => /heldout/iu.test(path.basename(file)))) throw new Error('heldout gold is outside this prototype scope');
  const output = path.join(fs.realpathSync(path.dirname(path.resolve(args.out))), path.basename(args.out));
  const privateRoot = fs.realpathSync(path.join(process.env.HOME, 'Documents/hermes-retrieval-private'));
  if (output === privateRoot || output.startsWith(`${privateRoot}${path.sep}`) || fs.existsSync(output)) throw new Error('--out must be a new file outside the private input directory');
  args.out = output;
  return args;
}

const csv = (value) => `"${String(value).replaceAll('"', '""')}"`;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const hashFile = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function runPsql(connection, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['--dbname', connection, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
      env: { ...process.env, PGCONNECT_TIMEOUT: '10', PGCLIENTENCODING: 'UTF8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    // SQL error context can contain private question/body text; do not log it.
    child.stderr.resume();
    child.on('error', reject);
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`psql failed (exit ${code}); SQL/input context suppressed`));
      try { resolve(stdout.trim().split('\n').filter(Boolean).map(JSON.parse)); }
      catch { reject(new Error('psql returned invalid JSON; output suppressed')); }
    });
    child.stdin.end(sql);
  });
}

function sqlFor(records, bodyFields, questions) {
  const docs = records.map((record) => [record.id, bodyFields.map((key) => typeof record[key] === 'string' ? record[key] : '').filter(Boolean).join('\n')].map(csv).join(',')).join('\n');
  const queries = questions.map((item) => [item.caseKey, item.question].map(csv).join(',')).join('\n');
  return `SET standard_conforming_strings = on;
SET statement_timeout = '120s';
CREATE TEMP TABLE proto_clock AS SELECT clock_timestamp() AS started;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TEMP TABLE proto_doc(record_id text primary key, body text);
COPY proto_doc(record_id, body) FROM STDIN WITH (FORMAT csv);
${docs}
\\.
CREATE INDEX proto_doc_body_trgm ON proto_doc USING gin (body gin_trgm_ops);
ANALYZE proto_doc;
CREATE TEMP TABLE proto_query(case_key text primary key, question text);
COPY proto_query(case_key, question) FROM STDIN WITH (FORMAT csv);
${queries}
\\.
SELECT json_build_object('kind', 'setup', 'version', version(), 'setupMs', extract(epoch FROM clock_timestamp() - started) * 1000) FROM proto_clock;
CREATE FUNCTION pg_temp.proto_rank(method text, question text) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE query_sql text; ids jsonb; started timestamptz; elapsed double precision; plan json;
BEGIN
  query_sql := 'SELECT jsonb_agg(record_id ORDER BY score DESC, record_id COLLATE "C") FROM (SELECT record_id, ' ||
    CASE method WHEN 'trgm' THEN 'similarity(body, $1)' WHEN 'trgmWord' THEN 'word_similarity($1, body)' END ||
    ' AS score FROM proto_doc ORDER BY score DESC, record_id COLLATE "C" LIMIT 200) ranked';
  started := clock_timestamp();
  EXECUTE query_sql INTO ids USING question;
  elapsed := extract(epoch FROM clock_timestamp() - started) * 1000;
  EXECUTE 'EXPLAIN (FORMAT JSON) ' || query_sql INTO plan USING question;
  RETURN jsonb_build_object('ids', ids, 'ms', elapsed, 'plan', plan);
END
$fn$;
${questions.map((item) => `SELECT json_build_object('kind', 'case', 'caseKey', case_key, 'trgm', pg_temp.proto_rank('trgm', question), 'trgmWord', pg_temp.proto_rank('trgmWord', question)) FROM proto_query WHERE case_key = ${literal(item.caseKey)};`).join('\n')}
`;
}

function planNodes(plan) {
  const visit = (node) => [node['Node Type'], ...(node.Plans ?? []).flatMap(visit)];
  return visit(plan[0].Plan);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const labels = JSON.parse(fs.readFileSync(args.labels, 'utf8'));
  const { records } = JSON.parse(fs.readFileSync(args.snapshot, 'utf8'));
  if (!Array.isArray(records) || !records.length || records.some((r) => typeof r.id !== 'string' || !r.id) || new Set(records.map((r) => r.id)).size !== records.length) throw new Error('snapshot needs records with unique string ids');
  if (records.some((r) => r.enrichment)) throw new Error('snapshot must contain body fields only, without enrichment');
  const questions = args.gold.flatMap((file) => readGold(file).map(({ id, question }) => ({ caseKey: caseKey(path.basename(file, '.json'), id), question })));
  if (new Set(questions.map((item) => item.caseKey)).size !== questions.length) throw new Error('duplicate caseKey');
  const bodyFields = fieldsWithRole(loadNonconformityCatalog(), 'body');
  const cases = questions.map((item) => {
    const pool = labels[item.caseKey] ?? {};
    const started = performance.now();
    const ids = rankBm25(records, bodyFields, item.question);
    return { caseKey: item.caseKey, relevantLabelled: Object.values(pool).filter((label) => label?.g === 3).length, bm25: scoreCandidates(ids, pool), ms: { bm25: performance.now() - started } };
  });
  console.error(`BM25 complete: ${cases.length} cases; measuring PostgreSQL`);
  const pgStarted = performance.now();
  const rows = await runPsql(args.pg, sqlFor(records, bodyFields, questions));
  const pgWallMs = performance.now() - pgStarted;
  const pgCases = new Map(rows.filter((row) => row.kind === 'case').map((row) => [row.caseKey, row]));
  if (pgCases.size !== cases.length) throw new Error('PostgreSQL case count mismatch');
  const plans = { trgm: new Set(), trgmWord: new Set() };
  for (const item of cases) {
    for (const method of ['trgm', 'trgmWord']) {
      const ranked = pgCases.get(item.caseKey)[method];
      if (ranked.ids.length !== Math.min(200, records.length) || new Set(ranked.ids).size !== ranked.ids.length) throw new Error('PostgreSQL candidate count mismatch');
      item[method] = scoreCandidates(ranked.ids, labels[item.caseKey] ?? {});
      item.ms[method] = ranked.ms;
      plans[method].add(planNodes(ranked.plan).join(' > '));
    }
  }
  const summary = summarize(cases);
  // One global choice, never select a different method per question.
  const better = ['trgm', 'trgmWord'].sort((a, b) => summary[b].top30.hits - summary[a].top30.hits || summary[b].top200.hits - summary[a].top200.hits || summary[a].p95Ms - summary[b].p95Ms)[0];
  const paired = Object.fromEntries(['trgm', 'trgmWord'].map((method) => [method, Object.fromEntries(['top30', 'top200'].map((depth) => [depth, {
    gained: cases.filter((item) => item[method][depth] && !item.bm25[depth]).map((item) => item.caseKey),
    lost: cases.filter((item) => !item[method][depth] && item.bm25[depth]).map((item) => item.caseKey),
  }]))]));
  const report = {
    schema: 'hermes-pg-trgm-recall-prototype/v1', measuredAt: new Date().toISOString(),
    inputs: [...args.gold, args.labels, args.snapshot].map((file) => ({ file: path.basename(file), sha256: hashFile(file) })),
    records: records.length, bodyFields,
    methodology: { query: 'raw question; no planner/gold hints/filters/enrichment', relevantGrade: 3, denominator: 'all input questions; false means no known grade-3 hit, not irrelevant', unlabeled: 'grade absent; excluded from relevance judgments', timing: 'one pass; BM25 index build + score + sort; PostgreSQL server plan + rank + aggregate, excludes setup/transport; nearest-rank percentiles', ties: 'BM25 existing localeCompare; PostgreSQL record_id COLLATE C', betterRule: 'top30 hits, then top200 hits, then lower p95' },
    postgres: { ...rows.find((row) => row.kind === 'setup'), pgWallMs, planNodes: Object.fromEntries(Object.entries(plans).map(([key, values]) => [key, [...values]])) },
    summary, bySet: Object.fromEntries([...new Set(cases.map((item) => item.caseKey.split('/')[0]))].map((name) => [name, summarize(cases.filter((item) => item.caseKey.startsWith(`${name}/`)))])),
    knownRelevantOnly: summarize(cases.filter((item) => item.relevantLabelled > 0)),
    noRelevantLabelled: cases.filter((item) => item.relevantLabelled === 0).map((item) => item.caseKey),
    betterTrgm: better, paired, cases,
  };
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ summary, betterTrgm: better }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
