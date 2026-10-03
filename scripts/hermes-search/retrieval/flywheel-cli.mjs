#!/usr/bin/env node
// Offline helper for the synthetic question flywheel. `pairs` samples contrastive pairs and seeds
// from a snapshot and a dense store and prints one JSON line per pair (ids, similarity, seed; no
// record text), so the pair selection can be checked before any model is called.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDenseStore } from './dense-dgx.mjs';
import { answerableIntents, bareId, samplePairs } from './flywheel-pairs.mjs';
import { createRandom, sampleSeed } from './flywheel-seeds.mjs';

export function parseArgs(argv) {
  const parsed = { mode: argv[0], snapshot: null, dense: null, count: 20, seed: 1 };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--snapshot') parsed.snapshot = argv[++index];
    else if (arg === '--dense') parsed.dense = argv[++index];
    else if (arg === '--count') parsed.count = Number(argv[++index]);
    else if (arg === '--seed') parsed.seed = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (parsed.mode !== 'pairs' || !parsed.snapshot || !parsed.dense || !Number.isInteger(parsed.count) || parsed.count < 1) {
    throw new Error('Usage: node retrieval/flywheel-cli.mjs pairs --snapshot <path> --dense <retrieval-dense-dgx.bin> [--count 20] [--seed 1]');
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = JSON.parse(fs.readFileSync(args.snapshot, 'utf8')).records.map((record) => ({ ...record, id: bareId(record.id) }));
  const byId = new Map(records.map((record) => [record.id, record]));
  const denseEntries = await readDenseStore(args.dense);
  const random = createRandom(args.seed);
  const pairs = samplePairs({ records, denseEntries, count: args.count, random });
  for (const pair of pairs) {
    const seed = sampleSeed({ random, allowedIntents: answerableIntents(byId.get(pair.a)) });
    process.stdout.write(`${JSON.stringify({ ...pair, seed })}\n`);
  }
  process.stderr.write(`pairs=${pairs.length} records=${records.length} vectors=${denseEntries.length}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
