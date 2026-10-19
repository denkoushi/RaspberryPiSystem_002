// Node 24's test runner glob `retrieval/` resolves to this directory.
// Loading the directory runs index.js, which registers every `*.test.mjs` file here.
// A hand-kept list missed enrichment, entity-link, and new test files until 2026-09-29.
import { readdirSync } from 'node:fs';

const directory = new URL('./', import.meta.url);
for (const name of readdirSync(directory).filter((file) => file.endsWith('.test.mjs')).sort()) {
  await import(new URL(name, directory));
}
