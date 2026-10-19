#!/usr/bin/env node
// Source digest of a kiosk SOP manual. It only reads files, so it runs without
// Docker, a browser, or built workspace packages (pre-commit hook and CI fast check).
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const generatorRuntimeInputs = Object.freeze([
  'infrastructure/docker/Dockerfile.kiosk-sop-generator',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml'
]);

export const manualSources = Object.freeze({
  'inspection-drawing': Object.freeze({
    definitionPath: 'apps/web/src/features/part-measurement/inspection-drawing/inspection-drawing-sop.definition.json',
    committedRoot: 'apps/web/src/generated/kiosk-sop/inspection-drawing'
  }),
  'assembly-procedure-template': Object.freeze({
    definitionPath: 'apps/web/src/features/assembly/assembly-procedure-template-sop.definition.json',
    committedRoot: 'apps/web/src/generated/kiosk-sop/assembly-procedure-template'
  })
});

function globRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§§').replace(/\*/g, '[^/]*').replace(/§§/g, '.*');
  return new RegExp(`^${escaped}$`);
}

async function listFiles(root, prefix = '') {
  const result = [];
  for (const name of await readdir(join(root, prefix))) {
    const path = join(prefix, name);
    const entry = await stat(join(root, path));
    if (entry.isDirectory()) result.push(...await listFiles(root, path)); else result.push(path);
  }
  return result;
}

export async function sourceDigest(definition, repoRoot) {
  const roots = new Set();
  for (const pattern of definition.supplementalWatchGlobs) {
    const wildcardAt = pattern.search(/[?*]/);
    const prefix = wildcardAt < 0 ? pattern : pattern.slice(0, wildcardAt);
    roots.add(prefix.endsWith('/') ? prefix.replace(/\/$/, '') : dirname(prefix));
  }
  const files = [];
  for (const root of roots) {
    const entry = await stat(join(repoRoot, root));
    if (entry.isDirectory()) files.push(...await listFiles(repoRoot, root)); else files.push(root);
  }
  const patterns = definition.supplementalWatchGlobs.map(globRegex);
  const selected = new Set([...definition.entrySources, ...generatorRuntimeInputs]);
  for (const file of files) if (patterns.some((pattern) => pattern.test(file))) selected.add(file);
  const chunks = [];
  for (const file of [...selected].sort()) chunks.push(`${file}\0${await readFile(join(repoRoot, file), 'utf8')}\0`);
  return createHash('sha256').update(chunks.join('')).digest('hex');
}

async function readManualState(manualId, repoRoot) {
  const manual = manualSources[manualId];
  const definition = JSON.parse(await readFile(join(repoRoot, manual.definitionPath), 'utf8'));
  const manifestPath = join(repoRoot, manual.committedRoot, 'manifest.json');
  const manifestText = await readFile(manifestPath, 'utf8');
  return {
    manifestPath,
    manifestText,
    committed: JSON.parse(manifestText).sourceSha256,
    current: await sourceDigest(definition, repoRoot)
  };
}

export async function staleManuals(repoRoot) {
  const stale = [];
  for (const manualId of Object.keys(manualSources)) {
    const { committed, current } = await readManualState(manualId, repoRoot);
    if (committed !== current) stale.push(manualId);
  }
  return stale;
}

// Rewrites only the digest value, so the rest of the committed manifest stays byte-identical.
// CI still regenerates the manual and compares geometry, HTML, and screenshots.
export async function refreshSourceDigests(repoRoot) {
  const refreshed = [];
  for (const manualId of Object.keys(manualSources)) {
    const { manifestPath, manifestText, committed, current } = await readManualState(manualId, repoRoot);
    if (committed === current) continue;
    if (manifestText.split(committed).length !== 2) throw new Error(`Cannot locate sourceSha256 in ${manifestPath}`);
    await writeFile(manifestPath, manifestText.replace(committed, current));
    refreshed.push(manualId);
  }
  return refreshed;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const command = process.argv[2] ?? 'check';
  if (command === 'check') {
    const stale = await staleManuals(repoRoot);
    if (stale.length) {
      console.error(`Kiosk SOP source digest is stale: ${stale.join(', ')}.`);
      console.error('A watched kiosk source changed after the manual was generated.');
      console.error('- Manual screens unchanged: run `pnpm kiosk-sop:source-refresh` and commit the manifest.');
      console.error('- Manual screens changed: run `pnpm kiosk-sop:generate` (Docker) and commit the output.');
      process.exit(1);
    }
    console.log('Kiosk SOP source digests are current.');
  } else if (command === 'refresh') {
    const refreshed = await refreshSourceDigests(repoRoot);
    console.log(refreshed.length ? `Refreshed kiosk SOP source digest: ${refreshed.join(', ')}. Commit the manifest.` : 'Kiosk SOP source digests are current.');
  } else {
    throw new Error(`Unknown kiosk SOP source digest command: ${command}`);
  }
}
