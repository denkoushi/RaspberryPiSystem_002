#!/usr/bin/env node

import { timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { validateKioskSopManifest } from '../../packages/kiosk-sop-core/dist/index.js';
import { sha256, stableJson } from '../../packages/kiosk-sop-core/dist/node.js';

// Archived native/emulated Chromium variants reached 0.287% perceptual drift
// at threshold 0.2. The 0.5% ceiling admits that renderer noise; exact source,
// DOM semantics, geometry, normalized HTML, and internal hashes remain separate
// release-blocking checks, and the material visual mutation fixture is 1%.
export const visualContract = Object.freeze({
  pixelmatchThreshold: 0.2,
  maxDiffPixelRatio: 0.005,
  includeAntialiasing: false
});

async function listFiles(root, prefix = '') {
  const result = [];
  for (const name of await readdir(join(root, prefix))) {
    const path = join(prefix, name);
    const entry = await stat(join(root, path));
    if (entry.isDirectory()) result.push(...await listFiles(root, path));
    else result.push(path);
  }
  return result;
}

function equalBuffers(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeManualHtml(html) {
  return html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, 'data:image/png;base64,<canonical-screen>');
}

async function readManifest(root) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  return validateKioskSopManifest(manifest);
}

export async function validateArtifactTree(root) {
  const manifest = await readManifest(root);
  const files = (await listFiles(root)).sort();
  const artifactFiles = files.filter((file) => file === 'manual.html' || extname(file) === '.png');
  const manifestFiles = Object.keys(manifest.artifacts).sort();
  const errors = [];

  if (stableJson(files) !== stableJson([...artifactFiles, 'manifest.json'].sort())) {
    errors.push(`unexpected files: ${files.filter((file) => file !== 'manifest.json' && !artifactFiles.includes(file)).join(', ')}`);
  }
  if (stableJson(artifactFiles) !== stableJson(manifestFiles)) {
    errors.push('manifest artifact file list does not match the tree');
  }
  for (const file of artifactFiles) {
    const digest = sha256(await readFile(join(root, file)));
    if (manifest.artifacts[file] !== digest) errors.push(`artifact hash mismatch: ${file}`);
  }
  const manual = await readFile(join(root, 'manual.html'));
  if (manifest.htmlSha256 !== sha256(manual)) errors.push('manual.html hash does not match manifest.htmlSha256');
  if (errors.length) throw new Error(`Invalid kiosk SOP artifact tree (${relative(process.cwd(), root)}): ${errors.join('; ')}`);
  return { manifest, manual, artifactFiles };
}

async function comparePng(expectedPath, actualPath, diffPath) {
  const expectedBuffer = await readFile(expectedPath);
  const actualBuffer = await readFile(actualPath);
  if (equalBuffers(expectedBuffer, actualBuffer)) {
    const image = PNG.sync.read(expectedBuffer);
    return { width: image.width, height: image.height, rawDiffPixels: 0, perceptualDiffPixels: 0, diffPixelRatio: 0, accepted: true };
  }

  const expected = PNG.sync.read(expectedBuffer);
  const actual = PNG.sync.read(actualBuffer);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      width: actual.width,
      height: actual.height,
      expectedWidth: expected.width,
      expectedHeight: expected.height,
      rawDiffPixels: null,
      perceptualDiffPixels: null,
      diffPixelRatio: 1,
      accepted: false,
      reason: 'image dimensions differ'
    };
  }

  const diff = new PNG({ width: expected.width, height: expected.height });
  let rawDiffPixels = 0;
  for (let offset = 0; offset < expected.data.length; offset += 4) {
    if (!expected.data.subarray(offset, offset + 4).equals(actual.data.subarray(offset, offset + 4))) rawDiffPixels += 1;
  }
  const perceptualDiffPixels = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, {
    threshold: visualContract.pixelmatchThreshold,
    includeAA: visualContract.includeAntialiasing
  });
  const pixelCount = expected.width * expected.height;
  const diffPixelRatio = perceptualDiffPixels / pixelCount;
  await mkdir(dirname(diffPath), { recursive: true });
  await writeFile(diffPath, PNG.sync.write(diff));
  return {
    width: expected.width,
    height: expected.height,
    rawDiffPixels,
    perceptualDiffPixels,
    diffPixelRatio,
    accepted: diffPixelRatio <= visualContract.maxDiffPixelRatio
  };
}

export async function verifyCrossRunnerArtifacts({ expectedRoot, actualRoot, previewPath, diagnosticsRoot }) {
  const expected = await validateArtifactTree(expectedRoot);
  const actual = await validateArtifactTree(actualRoot);
  const errors = [];
  const comparableManifestFields = [
    'schemaVersion',
    'generatorVersion',
    'browserVersion',
    'definitionSha256',
    'sourceSha256',
    'geometry'
  ];
  for (const field of comparableManifestFields) {
    if (stableJson(expected.manifest[field]) !== stableJson(actual.manifest[field])) {
      errors.push(`semantic manifest field is stale: ${field}`);
    }
  }
  if (stableJson(expected.artifactFiles) !== stableJson(actual.artifactFiles)) errors.push('generated artifact file list is stale');

  const expectedNormalizedHtml = normalizeManualHtml(expected.manual.toString('utf8'));
  const actualNormalizedHtml = normalizeManualHtml(actual.manual.toString('utf8'));
  if (expectedNormalizedHtml !== actualNormalizedHtml) errors.push('manual DOM/CSS content is stale after normalizing embedded screen bytes');
  if (!equalBuffers(expected.manual, await readFile(previewPath))) errors.push('documentation preview does not match committed manual.html');

  const images = {};
  for (const file of expected.artifactFiles.filter((artifact) => extname(artifact) === '.png')) {
    const result = await comparePng(
      join(expectedRoot, file),
      join(actualRoot, file),
      join(diagnosticsRoot, 'visual-diffs', file)
    );
    images[file] = result;
    if (!result.accepted) errors.push(`visual difference exceeds contract: ${file} (${result.diffPixelRatio})`);
  }
  const report = {
    schemaVersion: 1,
    classification: errors.length ? 'content-or-contract-mismatch' : 'semantically-current',
    visualContract,
    semanticFields: comparableManifestFields,
    images,
    errors
  };
  await mkdir(diagnosticsRoot, { recursive: true });
  await writeFile(join(diagnosticsRoot, 'visual-report.json'), stableJson(report));
  if (errors.length) throw new Error(`Kiosk SOP artifact contract failed: ${errors.join('; ')}`);
  return report;
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return resolve(process.argv[index + 1]);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const command = process.argv[2];
  if (command === 'verify') {
    await verifyCrossRunnerArtifacts({
      expectedRoot: option('--expected-root'),
      actualRoot: option('--actual-root'),
      previewPath: option('--preview'),
      diagnosticsRoot: option('--diagnostics-root')
    });
    console.log('Kiosk SOP semantic, integrity, geometry, and visual contracts passed.');
  } else {
    throw new Error(`Unknown kiosk SOP artifact contract command: ${command}`);
  }
}
