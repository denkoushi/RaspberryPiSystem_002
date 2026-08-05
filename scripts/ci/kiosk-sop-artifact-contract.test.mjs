import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PNG } from 'pngjs';

import { sha256, stableJson } from '../../packages/kiosk-sop-core/dist/node.js';
import { validateArtifactTree, verifyCrossRunnerArtifacts } from './kiosk-sop-artifact-contract.mjs';

function pngBuffer(changedPixels = 0, width = 100, height = 100) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  for (let index = 0; index < changedPixels; index += 1) {
    const offset = index * 4;
    png.data[offset] = 0;
    png.data[offset + 1] = 0;
    png.data[offset + 2] = 0;
  }
  return PNG.sync.write(png);
}

async function writeTree(root, {
  image = pngBuffer(),
  sourceSha256 = 'a'.repeat(64),
  embeddedImage = image,
  manualText = '保存',
  targetId = 'target',
  targetX = 0.5,
  targetText = '保存'
} = {}) {
  await mkdir(join(root, 'screens'), { recursive: true });
  const manual = Buffer.from(`<html><span>${manualText}</span><img src="data:image/png;base64,${embeddedImage.toString('base64')}"></html>`);
  await writeFile(join(root, 'screens', 'main.png'), image);
  await writeFile(join(root, 'manual.html'), manual);
  const artifacts = {
    'manual.html': sha256(manual),
    'screens/main.png': sha256(image)
  };
  const manifest = {
    schemaVersion: 1,
    generatorVersion: 'test-generator',
    browserVersion: 'test-browser',
    definitionSha256: 'b'.repeat(64),
    sourceSha256,
    htmlSha256: sha256(manual),
    geometry: {
      main: [{
        id: 'step',
        targetId,
        target: { x: targetX, y: 0.5 },
        semantics: { tagName: 'button', role: null, text: targetText, ariaLabel: null }
      }]
    },
    artifacts
  };
  await writeFile(join(root, 'manifest.json'), stableJson(manifest));
  return manual;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kiosk-sop-artifact-contract-'));
  const expectedRoot = join(root, 'expected');
  const actualRoot = join(root, 'actual');
  const diagnosticsRoot = join(root, 'diagnostics');
  const previewPath = join(root, 'preview.html');
  const expectedManual = await writeTree(expectedRoot);
  await writeFile(previewPath, expectedManual);
  return { root, expectedRoot, actualRoot, diagnosticsRoot, previewPath };
}

test('accepts the observed scale of bounded antialias raster drift', async () => {
  const paths = await fixture();
  try {
    await writeTree(paths.actualRoot, { image: pngBuffer(30), embeddedImage: pngBuffer(30) });
    const report = await verifyCrossRunnerArtifacts(paths);
    assert.equal(report.classification, 'semantically-current');
    assert.equal(report.images['screens/main.png'].rawDiffPixels, 30);
    assert.equal(report.images['screens/main.png'].accepted, true);
    await assert.doesNotReject(() => validateArtifactTree(paths.expectedRoot));
  } finally {
    await rm(paths.root, { recursive: true, force: true });
  }
});

test('fails closed for stale source input and material visual change', async () => {
  const paths = await fixture();
  try {
    await writeTree(paths.actualRoot, { image: pngBuffer(100), embeddedImage: pngBuffer(100), sourceSha256: 'c'.repeat(64) });
    await assert.rejects(() => verifyCrossRunnerArtifacts(paths), /sourceSha256.*visual difference exceeds contract/);
    const report = JSON.parse(await readFile(join(paths.diagnosticsRoot, 'visual-report.json'), 'utf8'));
    assert.equal(report.classification, 'content-or-contract-mismatch');
  } finally {
    await rm(paths.root, { recursive: true, force: true });
  }
});

test('fails closed for instruction text, target DOM semantics, and geometry mutations', async () => {
  for (const mutation of [
    { manualText: '削除' },
    { targetId: 'delete' },
    { targetText: '削除' },
    { targetX: 0.75 }
  ]) {
    const paths = await fixture();
    try {
      await writeTree(paths.actualRoot, mutation);
      await assert.rejects(() => verifyCrossRunnerArtifacts(paths), /manual DOM\/CSS content is stale|geometry/);
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  }
});

test('fails closed for image dimension changes and missing artifacts', async () => {
  const dimensions = await fixture();
  try {
    await writeTree(dimensions.actualRoot, { image: pngBuffer(0, 120, 100), embeddedImage: pngBuffer(0, 120, 100) });
    await assert.rejects(() => verifyCrossRunnerArtifacts(dimensions), /visual difference exceeds contract/);
  } finally {
    await rm(dimensions.root, { recursive: true, force: true });
  }

  const missing = await fixture();
  try {
    await writeTree(missing.actualRoot);
    await unlink(join(missing.actualRoot, 'screens', 'main.png'));
    await assert.rejects(() => verifyCrossRunnerArtifacts(missing), /manifest artifact file list/);
  } finally {
    await rm(missing.root, { recursive: true, force: true });
  }
});

test('rejects artifact tampering', async () => {
  const paths = await fixture();
  try {
    await writeFile(join(paths.expectedRoot, 'screens', 'main.png'), pngBuffer(2));
    await assert.rejects(() => validateArtifactTree(paths.expectedRoot), /artifact hash mismatch/);
  } finally {
    await rm(paths.root, { recursive: true, force: true });
  }
});
