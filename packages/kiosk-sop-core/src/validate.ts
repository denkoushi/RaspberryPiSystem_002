import type { KioskSopDefinition, KioskSopManifest, KioskSopTarget } from './types.js';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function assertId(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) throw new Error(`${label} must match ${ID_PATTERN}: ${value}`);
}

function assertUnique(values: readonly string[], label: string): void {
  const duplicate = values.find((value, index) => values.indexOf(value) !== index);
  if (duplicate) throw new Error(`Duplicate ${label}: ${duplicate}`);
}

function assertTarget(target: KioskSopTarget, label: string): void {
  if (target.x < 0 || target.x > 1 || target.y < 0 || target.y > 1) {
    throw new Error(`Target must use normalized coordinates: ${label}`);
  }
}

function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
}

export function validateKioskSopDefinition(definition: KioskSopDefinition): KioskSopDefinition {
  if (definition.schemaVersion !== 1) throw new Error('Unsupported kiosk SOP schemaVersion.');
  assertId(definition.id, 'manual id');
  if (!definition.title.trim()) throw new Error('Manual title is required.');
  if (definition.entrySources.length === 0) throw new Error('At least one entry source is required.');
  assertUnique(definition.exclusions.map(({ id }) => id), 'exclusion id');
  definition.exclusions.forEach(({ id, reason }) => {
    assertId(id, 'exclusion id');
    if (!reason.trim()) throw new Error(`Exclusion reason is required: ${id}`);
  });
  assertUnique(definition.scenarios.map(({ id }) => id), 'scenario id');
  const allSheets = definition.scenarios.flatMap(({ sheets }) => sheets);
  assertUnique(allSheets.map(({ id }) => id), 'sheet id');
  const allSteps = allSheets.flatMap(({ steps }) => steps);
  assertUnique(allSteps.map(({ id }) => id), 'step id');
  assertUnique(allSteps.map(({ targetId }) => targetId), 'target id');
  for (const scenario of definition.scenarios) {
    assertId(scenario.id, 'scenario id');
    if (!scenario.productionRoute.startsWith('/')) throw new Error(`Route must be absolute: ${scenario.id}`);
    if (scenario.viewport.deviceScaleFactor !== 1) throw new Error('deviceScaleFactor must be 1.');
    for (const sheet of scenario.sheets) {
      assertId(sheet.id, 'sheet id');
      if (!sheet.screenImageDataUrl.startsWith('data:image/png;base64,')) {
        throw new Error(`Sheet image must be an inline PNG data URL: ${sheet.id}`);
      }
      if (sheet.steps.length === 0) throw new Error(`Sheet requires steps: ${sheet.id}`);
      for (const step of sheet.steps) {
        assertId(step.id, 'step id');
        assertId(step.targetId, 'target id');
        if (!step.title.trim() || !step.description.trim()) throw new Error(`Step text is required: ${step.id}`);
        if (step.necessity !== 'required' && step.necessity !== 'optional') {
          throw new Error(`Invalid necessity: ${step.id}`);
        }
        assertTarget(step.target, step.id);
      }
    }
  }
  return definition;
}

export function validateKioskSopManifest(manifest: KioskSopManifest): KioskSopManifest {
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported kiosk SOP manifest schemaVersion.');
  if (!manifest.generatorVersion.trim() || !manifest.browserVersion.trim()) {
    throw new Error('Manifest generator and browser versions are required.');
  }
  assertSha256(manifest.definitionSha256, 'definitionSha256');
  assertSha256(manifest.sourceSha256, 'sourceSha256');
  assertSha256(manifest.htmlSha256, 'htmlSha256');
  if (Object.keys(manifest.geometry).length === 0) throw new Error('Manifest geometry is required.');
  for (const [sheetId, rows] of Object.entries(manifest.geometry)) {
    assertId(sheetId, 'manifest sheet id');
    if (rows.length === 0) throw new Error(`Manifest sheet geometry is empty: ${sheetId}`);
    assertUnique(rows.map(({ id }) => id), `manifest step id in ${sheetId}`);
    assertUnique(rows.map(({ targetId }) => targetId), `manifest target id in ${sheetId}`);
    rows.forEach(({ id, targetId, target, semantics }) => {
      assertId(id, 'manifest step id');
      assertId(targetId, 'manifest target id');
      assertTarget(target, id);
      if (!semantics || !/^[a-z][a-z0-9-]*$/.test(semantics.tagName)) {
        throw new Error(`Manifest DOM tagName is invalid: ${sheetId}/${targetId}`);
      }
      if (semantics.role !== null && typeof semantics.role !== 'string') {
        throw new Error(`Manifest DOM role is invalid: ${sheetId}/${targetId}`);
      }
      if (typeof semantics.text !== 'string') {
        throw new Error(`Manifest DOM text is invalid: ${sheetId}/${targetId}`);
      }
      if (semantics.ariaLabel !== null && typeof semantics.ariaLabel !== 'string') {
        throw new Error(`Manifest DOM ariaLabel is invalid: ${sheetId}/${targetId}`);
      }
    });
  }
  if (Object.keys(manifest.artifacts).length === 0) throw new Error('Manifest artifacts are required.');
  for (const [artifactPath, digest] of Object.entries(manifest.artifacts)) {
    if (artifactPath.startsWith('/') || artifactPath.includes('..')) {
      throw new Error(`Manifest artifact path must be repository-relative: ${artifactPath}`);
    }
    assertSha256(digest, `artifact ${artifactPath}`);
  }
  return manifest;
}
