import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { generatorRuntimeInputs, manualSources, refreshSourceDigests, sourceDigest, staleManuals } from './source-digest.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function fixtureRepo() {
  const root = await mkdtemp(join(tmpdir(), 'kiosk-sop-source-digest-'));
  const write = async (path, text) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  for (const file of generatorRuntimeInputs) await write(file, `${file}\n`);
  for (const [manualId, manual] of Object.entries(manualSources)) {
    const definition = { entrySources: [`src/${manualId}/Entry.tsx`], supplementalWatchGlobs: [`src/${manualId}/**`] };
    await write(manual.definitionPath, JSON.stringify(definition));
    await write(`src/${manualId}/Entry.tsx`, 'entry\n');
    await write(`src/${manualId}/nested/Part.tsx`, 'part\n');
    const manifest = { schemaVersion: 1, sourceSha256: await sourceDigest(definition, root), htmlSha256: 'kept' };
    await write(join(manual.committedRoot, 'manifest.json'), JSON.stringify(manifest));
  }
  return root;
}

test('committed manifests match the current kiosk sources', async () => {
  assert.deepEqual(await staleManuals(repoRoot), []);
});

test('a watched source change is stale for its manual only, and refresh rewrites just the digest', async () => {
  const root = await fixtureRepo();
  try {
    assert.deepEqual(await staleManuals(root), []);
    await writeFile(join(root, 'src/assembly-procedure-template/nested/Part.tsx'), 'changed\n');
    assert.deepEqual(await staleManuals(root), ['assembly-procedure-template']);

    const manifestPath = join(root, manualSources['assembly-procedure-template'].committedRoot, 'manifest.json');
    const before = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.deepEqual(await refreshSourceDigests(root), ['assembly-procedure-template']);
    const after = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.notEqual(after.sourceSha256, before.sourceSha256);
    assert.deepEqual({ ...after, sourceSha256: before.sourceSha256 }, before);
    assert.deepEqual(await staleManuals(root), []);
    assert.deepEqual(await refreshSourceDigests(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a generator runtime input change is stale for every manual', async () => {
  const root = await fixtureRepo();
  try {
    await cp(join(root, 'package.json'), join(root, 'pnpm-lock.yaml'));
    assert.deepEqual(await staleManuals(root), Object.keys(manualSources));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
