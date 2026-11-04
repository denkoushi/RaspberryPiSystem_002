import { describe, expect, it } from 'vitest';

import { validateKioskSopDefinition, validateKioskSopManifest } from './validate.js';

import type { KioskSopDefinition, KioskSopManifest, KioskSopSheet, KioskSopStep } from './types.js';

const step = (overrides: Partial<KioskSopStep> = {}): KioskSopStep => ({
  id: 'save-step',
  targetId: 'save',
  necessity: 'required',
  title: '保存',
  description: '保存します',
  target: { x: 0.5, y: 0.5 },
  ...overrides
});

const sheet = (overrides: Partial<KioskSopSheet> = {}): KioskSopSheet => ({
  id: 'first',
  title: '操作',
  summary: '概要',
  screenImageDataUrl: 'data:image/png;base64,AA==',
  steps: [step()],
  ...overrides
});

function definition(overrides: Partial<KioskSopDefinition> = {}, sheets: KioskSopSheet[] = [sheet()]): KioskSopDefinition {
  return {
    schemaVersion: 1,
    id: 'sample-manual',
    title: 'サンプル',
    entrySources: ['src/page.tsx'],
    supplementalWatchGlobs: [],
    exclusions: [],
    scenarios: [{
      id: 'main',
      productionRoute: '/kiosk/sample',
      fixtureId: 'sample',
      viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
      sheets
    }],
    ...overrides
  };
}

const DIGEST = 'b'.repeat(64);

function manifest(overrides: Partial<KioskSopManifest> = {}): KioskSopManifest {
  return {
    schemaVersion: 1,
    generatorVersion: '1.0.0',
    browserVersion: '141.0.0.0',
    definitionSha256: DIGEST,
    sourceSha256: DIGEST,
    htmlSha256: DIGEST,
    geometry: {
      first: [{
        id: 'save-step',
        targetId: 'save',
        target: { x: 0, y: 1 },
        semantics: { tagName: 'button', role: 'button', text: '保存', ariaLabel: '保存' }
      }]
    },
    artifacts: { 'docs/sop/main.png': DIGEST },
    ...overrides
  };
}

describe('validateKioskSopDefinition', () => {
  it('returns the same definition object when valid, including targets on the 0/1 boundary', () => {
    const valid = definition({}, [sheet({ steps: [step({ target: { x: 0, y: 1 } })] })]);
    expect(validateKioskSopDefinition(valid)).toBe(valid);
  });

  it.each([
    ['schemaVersion', definition({ schemaVersion: 2 as 1 }), 'Unsupported kiosk SOP schemaVersion.'],
    ['uppercase id', definition({ id: 'Sample' }), /manual id must match/],
    ['id starting with a digit', definition({ id: '1manual' }), /manual id must match/],
    ['blank title', definition({ title: '   ' }), 'Manual title is required.'],
    ['no entry sources', definition({ entrySources: [] }), 'At least one entry source is required.']
  ])('rejects %s', (_label, input, message) => {
    expect(() => validateKioskSopDefinition(input)).toThrow(message);
  });

  it('rejects duplicate and malformed exclusions', () => {
    expect(() => validateKioskSopDefinition(definition({
      exclusions: [{ id: 'dup', reason: 'a' }, { id: 'dup', reason: 'b' }]
    }))).toThrow('Duplicate exclusion id: dup');
    expect(() => validateKioskSopDefinition(definition({
      exclusions: [{ id: 'Bad_Id', reason: 'a' }]
    }))).toThrow(/exclusion id must match/);
  });

  it('rejects relative routes, non-1 device scale factors and non-PNG sheet images', () => {
    const base = definition();
    const scenario = base.scenarios[0];
    expect(() => validateKioskSopDefinition({ ...base, scenarios: [{ ...scenario, productionRoute: 'kiosk/sample' }] }))
      .toThrow('Route must be absolute: main');
    expect(() => validateKioskSopDefinition({
      ...base,
      scenarios: [{ ...scenario, viewport: { ...scenario.viewport, deviceScaleFactor: 2 as 1 } }]
    })).toThrow('deviceScaleFactor must be 1.');
    expect(() => validateKioskSopDefinition(definition({}, [sheet({ screenImageDataUrl: 'data:image/jpeg;base64,AA==' })])))
      .toThrow('Sheet image must be an inline PNG data URL: first');
  });

  it('rejects empty sheets, blank step text and out-of-range targets', () => {
    expect(() => validateKioskSopDefinition(definition({}, [sheet({ steps: [] })]))).toThrow('Sheet requires steps: first');
    expect(() => validateKioskSopDefinition(definition({}, [sheet({ steps: [step({ description: ' ' })] })])))
      .toThrow('Step text is required: save-step');
    expect(() => validateKioskSopDefinition(definition({}, [sheet({ steps: [step({ target: { x: 1.01, y: 0 } })] })])))
      .toThrow('Target must use normalized coordinates: save-step');
    expect(() => validateKioskSopDefinition(definition({}, [sheet({ steps: [step({ target: { x: 0, y: -0.01 } })] })])))
      .toThrow('Target must use normalized coordinates: save-step');
  });

  it.each([
    ['x = 1', { x: 1, y: 0 }],
    ['y = 1 and x = 0', { x: 0, y: 1 }],
    ['both 0', { x: 0, y: 0 }],
    ['both 1', { x: 1, y: 1 }]
  ])('accepts boundary target %s', (_label, target) => {
    const valid = definition({}, [sheet({ steps: [step({ target })] })]);
    expect(validateKioskSopDefinition(valid)).toBe(valid);
  });

  it.each([
    ['x < 0', { x: -0.01, y: 0.5 }],
    ['x > 1', { x: 1.01, y: 0.5 }],
    ['y < 0', { x: 0.5, y: -0.01 }],
    ['y > 1', { x: 0.5, y: 1.01 }]
  ])('rejects step target with %s', (_label, target) => {
    expect(() => validateKioskSopDefinition(definition({}, [sheet({ steps: [step({ target })] })])))
      .toThrow('Target must use normalized coordinates: save-step');
  });

  it('rejects blank step title, invalid necessity and blank exclusion reason', () => {
    expect(() => validateKioskSopDefinition(definition({}, [sheet({ steps: [step({ title: '  ' })] })])))
      .toThrow('Step text is required: save-step');
    expect(() => validateKioskSopDefinition(definition({}, [
      sheet({ steps: [step({ necessity: 'maybe' as unknown as 'required' })] })
    ]))).toThrow('Invalid necessity: save-step');
    const optional = definition({}, [sheet({ steps: [step({ necessity: 'optional' })] })]);
    expect(validateKioskSopDefinition(optional)).toBe(optional);
    expect(() => validateKioskSopDefinition(definition({ exclusions: [{ id: 'skip-me', reason: '   ' }] })))
      .toThrow('Exclusion reason is required: skip-me');
    const withExclusion = definition({ exclusions: [{ id: 'skip-me', reason: '対象外' }] });
    expect(validateKioskSopDefinition(withExclusion)).toBe(withExclusion);
  });

  it('rejects duplicate scenario ids and duplicate step ids across sheets', () => {
    const base = definition();
    const scenario = base.scenarios[0];
    expect(() => validateKioskSopDefinition({
      ...base,
      scenarios: [scenario, { ...scenario, sheets: [sheet({ id: 'second', steps: [step({ id: 'b', targetId: 'b' })] })] }]
    })).toThrow('Duplicate scenario id: main');
    expect(() => validateKioskSopDefinition(definition({}, [
      sheet(),
      sheet({ id: 'second', steps: [step({ targetId: 'other' })] })
    ]))).toThrow('Duplicate step id: save-step');
  });

  it('requires sheet ids and target ids to be unique across all sheets of the manual', () => {
    expect(() => validateKioskSopDefinition(definition({}, [
      sheet(),
      sheet({ steps: [step({ id: 'other-step' })], id: 'first' })
    ]))).toThrow('Duplicate sheet id: first');
    expect(() => validateKioskSopDefinition(definition({}, [
      sheet(),
      sheet({ id: 'second', steps: [step({ id: 'other-step' })] })
    ]))).toThrow('Duplicate target id: save');
  });
});

describe('validateKioskSopManifest', () => {
  it('accepts a valid manifest with boundary targets', () => {
    const valid = manifest();
    expect(validateKioskSopManifest(valid)).toBe(valid);
  });

  it('rejects missing versions and uppercase digests', () => {
    expect(() => validateKioskSopManifest(manifest({ browserVersion: ' ' })))
      .toThrow('Manifest generator and browser versions are required.');
    expect(() => validateKioskSopManifest(manifest({ generatorVersion: '  ' })))
      .toThrow('Manifest generator and browser versions are required.');
    expect(() => validateKioskSopManifest(manifest({ htmlSha256: 'A'.repeat(64) })))
      .toThrow('htmlSha256 must be a lowercase SHA-256 digest.');
    expect(() => validateKioskSopManifest(manifest({ definitionSha256: 'b'.repeat(63) })))
      .toThrow(/definitionSha256/);
  });

  it('rejects empty geometry, empty sheet rows and duplicate rows', () => {
    expect(() => validateKioskSopManifest(manifest({ geometry: {} }))).toThrow('Manifest geometry is required.');
    expect(() => validateKioskSopManifest(manifest({ geometry: { first: [] } }))).toThrow('Manifest sheet geometry is empty: first');
    const row = manifest().geometry.first[0];
    expect(() => validateKioskSopManifest(manifest({ geometry: { first: [row, { ...row, targetId: 'other' }] } })))
      .toThrow('Duplicate manifest step id in first: save-step');
    expect(() => validateKioskSopManifest(manifest({ geometry: { first: [row, { ...row, id: 'other-step' }] } })))
      .toThrow('Duplicate manifest target id in first: save');
  });

  it('accepts geometry rows on every coordinate boundary and rejects out-of-range rows', () => {
    const row = manifest().geometry.first[0];
    for (const target of [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }]) {
      const valid = manifest({ geometry: { first: [{ ...row, target }] } });
      expect(validateKioskSopManifest(valid)).toBe(valid);
    }
    for (const target of [{ x: -0.01, y: 0.5 }, { x: 1.01, y: 0.5 }, { x: 0.5, y: -0.01 }, { x: 0.5, y: 1.01 }]) {
      expect(() => validateKioskSopManifest(manifest({ geometry: { first: [{ ...row, target }] } })))
        .toThrow('Target must use normalized coordinates: save-step');
    }
  });

  it('allows null role and null ariaLabel but rejects a non-string ariaLabel', () => {
    const row = manifest().geometry.first[0];
    const valid = manifest({
      geometry: { first: [{ ...row, semantics: { ...row.semantics, role: null, ariaLabel: null } }] }
    });
    expect(validateKioskSopManifest(valid)).toBe(valid);
    expect(() => validateKioskSopManifest(manifest({
      geometry: { first: [{ ...row, semantics: { ...row.semantics, ariaLabel: 5 as unknown as string } }] }
    }))).toThrow('Manifest DOM ariaLabel is invalid: first/save');
  });

  it('validates DOM semantics of each geometry row', () => {
    const row = manifest().geometry.first[0];
    expect(() => validateKioskSopManifest(manifest({
      geometry: { first: [{ ...row, semantics: { ...row.semantics, tagName: 'BUTTON' } }] }
    }))).toThrow('Manifest DOM tagName is invalid: first/save');
    expect(() => validateKioskSopManifest(manifest({
      geometry: { first: [{ ...row, semantics: { ...row.semantics, role: 1 as unknown as string } }] }
    }))).toThrow('Manifest DOM role is invalid: first/save');
    expect(() => validateKioskSopManifest(manifest({
      geometry: { first: [{ ...row, semantics: { ...row.semantics, text: null as unknown as string } }] }
    }))).toThrow('Manifest DOM text is invalid: first/save');
  });

  it('rejects missing artifacts, absolute paths and bad artifact digests', () => {
    expect(() => validateKioskSopManifest(manifest({ artifacts: {} }))).toThrow('Manifest artifacts are required.');
    expect(() => validateKioskSopManifest(manifest({ artifacts: { '/etc/main.png': DIGEST } })))
      .toThrow('Manifest artifact path must be repository-relative: /etc/main.png');
    expect(() => validateKioskSopManifest(manifest({ artifacts: { 'docs/../secret.png': DIGEST } })))
      .toThrow('Manifest artifact path must be repository-relative: docs/../secret.png');
    expect(() => validateKioskSopManifest(manifest({ artifacts: { 'docs/main.png': 'deadbeef' } })))
      .toThrow('artifact docs/main.png must be a lowercase SHA-256 digest.');
  });
});
