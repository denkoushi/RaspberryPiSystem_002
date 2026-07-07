#!/usr/bin/env node
/**
 * kiosk-documents 一覧 API のスケール比較（従来全件 vs summary+limit）。
 *
 * 実行例:
 *   node scripts/perf/measure-kiosk-documents-api.mjs
 *   node scripts/perf/measure-kiosk-documents-api.mjs tmp/perf-results/kiosk-docs-api.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

const API_BASE = (process.env.PERF_API_BASE_URL ?? 'http://localhost:8080/api').replace(/\/$/, '');
const CLIENT_KEY = process.env.PERF_CLIENT_KEY?.trim() ?? 'client-key-raspberrypi4-kiosk1';
const RUNS = 3;
const DEFAULT_OUTPUT = path.join(repoRoot, 'tmp/perf-results/kiosk-docs-api-scale.json');

/**
 * @param {string} urlPath
 */
async function measureOnce(urlPath) {
  const started = performance.now();
  const res = await fetch(`${API_BASE}${urlPath}`, {
    headers: { 'x-client-key': CLIENT_KEY, Accept: 'application/json' },
  });
  const body = await res.text();
  const totalMs = performance.now() - started;
  if (!res.ok) {
    throw new Error(`${urlPath} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return {
    status: res.status,
    totalMs: Math.round(totalMs),
    bytes: Buffer.byteLength(body, 'utf8'),
    documentCount: JSON.parse(body).documents?.length ?? 0,
  };
}

/**
 * @param {string} urlPath
 */
async function measureScenario(urlPath) {
  const samples = [];
  for (let i = 0; i < RUNS; i += 1) {
    samples.push(await measureOnce(urlPath));
  }
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return {
    cold: samples[0],
    warm: samples.slice(1),
    median: {
      totalMs: Math.round(median(samples.map((s) => s.totalMs))),
      bytes: Math.round(median(samples.map((s) => s.bytes))),
      documentCount: Math.round(median(samples.map((s) => s.documentCount))),
    },
  };
}

async function main() {
  const outputPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : DEFAULT_OUTPUT;
  await mkdir(path.dirname(outputPath), { recursive: true });

  const scenarios = {
    legacyAll: '/kiosk-documents?hideDisabled=true',
    summaryLimit200: '/kiosk-documents?hideDisabled=true&fields=summary&limit=200',
    procedureSequence: null,
  };

  const manifestPath = path.join(repoRoot, 'tmp/perf-storage/perf-seed-manifest.json');
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.assemblyWorkSessionId) {
      scenarios.procedureSequence = `/assembly/work-sessions/${manifest.assemblyWorkSessionId}/procedure-sequence`;
    }
  } catch {
    // optional
  }

  const results = {
    measuredAt: new Date().toISOString(),
    apiBase: API_BASE,
    runs: RUNS,
    scenarios: {},
  };

  for (const [name, urlPath] of Object.entries(scenarios)) {
    if (!urlPath) continue;
    results.scenarios[name] = await measureScenario(urlPath);
    console.log(`${name}: ${JSON.stringify(results.scenarios[name].median)}`);
  }

  await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(`wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
