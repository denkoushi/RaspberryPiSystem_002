// Copy the private enrichment store on the host that already holds it.
// Prints counts only. This does not transfer the file to another machine.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnrichmentStore, storePathFromEnv, writeEnrichmentStore } from './enrichment-store.mjs';

export async function exportEnrichmentStore(source, output) {
  if (!path.isAbsolute(output)) throw new Error('output path must be absolute');
  const byId = await readEnrichmentStore(source);
  await writeEnrichmentStore(output, byId);
  return { records: byId.size };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output' || !path.isAbsolute(args[1])) {
    throw new Error('Use --output /absolute/retrieval-enrichment.jsonl');
  }
  const result = await exportEnrichmentStore(storePathFromEnv(), args[1]);
  console.log(JSON.stringify({ records: result.records }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('hermes retrieval enrichment export failed');
    process.exitCode = 1;
  });
}
