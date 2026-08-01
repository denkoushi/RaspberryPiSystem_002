import { describe, expect, it } from 'vitest';

import {
  KIOSK_SOP_TOKENS,
  renderKioskSopHtml,
  validateKioskSopDefinition,
  validateKioskSopManifest
} from './index.js';
import type { KioskSopDefinition, KioskSopManifest } from './index.js';

const definition: KioskSopDefinition = {
  schemaVersion: 1,
  id: 'sample-manual',
  title: 'サンプル',
  entrySources: ['src/page.tsx'],
  supplementalWatchGlobs: [],
  exclusions: [{ id: 'close-dialog', reason: 'ビューアー共通操作' }],
  scenarios: [{
    id: 'main', productionRoute: '/kiosk/sample', fixtureId: 'sample',
    viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    sheets: [{
      id: 'first', title: '操作', summary: '概要',
      screenImageDataUrl: 'data:image/png;base64,AA==',
      steps: [
        { id: 'required-step', targetId: 'save', necessity: 'required', title: '保存', description: '保存します', target: { x: .8, y: .1 } },
        { id: 'optional-step', targetId: 'filter', necessity: 'optional', title: '絞込', description: '必要に応じて絞ります', target: { x: .2, y: .2 } }
      ]
    }]
  }]
};

describe('kiosk SOP core', () => {
  it('renders required and subdued optional semantics deterministically', () => {
    const first = renderKioskSopHtml(definition);
    expect(renderKioskSopHtml(definition)).toBe(first);
    expect(first).toContain('必須');
    expect(first).toContain('任意');
    expect(first).toContain(KIOSK_SOP_TOKENS.required.color);
    expect(first).toContain(KIOSK_SOP_TOKENS.optional.color);
    expect(first).toContain('stroke-dasharray="8 6"');
  });

  it('rejects duplicate ids and out-of-range targets', () => {
    const scenario = definition.scenarios[0];
    const sheet = scenario.sheets[0];
    const invalid: KioskSopDefinition = {
      ...definition,
      scenarios: [{
        ...scenario,
        sheets: [{
          ...sheet,
          steps: [sheet.steps[0], { ...sheet.steps[1], id: 'required-step', target: { x: 2, y: .2 } }]
        }]
      }]
    };
    expect(() => validateKioskSopDefinition(invalid)).toThrow(/Duplicate step id/);
  });

  it('rejects duplicate target ids, invalid necessity, and missing exclusion reasons', () => {
    const scenario = definition.scenarios[0];
    const sheet = scenario.sheets[0];
    expect(() => validateKioskSopDefinition({
      ...definition,
      scenarios: [{
        ...scenario,
        sheets: [{
          ...sheet,
          steps: [sheet.steps[0], { ...sheet.steps[1], targetId: sheet.steps[0].targetId }]
        }]
      }]
    })).toThrow(/Duplicate target id/);
    expect(() => validateKioskSopDefinition({
      ...definition,
      scenarios: [{
        ...scenario,
        sheets: [{
          ...sheet,
          steps: [{ ...sheet.steps[0], necessity: 'conditional' as 'required' }]
        }]
      }]
    })).toThrow(/Invalid necessity/);
    expect(() => validateKioskSopDefinition({
      ...definition,
      exclusions: [{ id: 'close-dialog', reason: '' }]
    })).toThrow(/Exclusion reason is required/);
  });

  it('validates manifest digests, geometry, and artifact paths', () => {
    const digest = 'a'.repeat(64);
    const manifest: KioskSopManifest = {
      schemaVersion: 1,
      generatorVersion: '1.0.0',
      browserVersion: '141.0.0.0',
      definitionSha256: digest,
      sourceSha256: digest,
      htmlSha256: digest,
      geometry: {
        first: [{ id: 'required-step', targetId: 'save', target: { x: .8, y: .1 } }]
      },
      artifacts: { 'screens/main.png': digest }
    };
    expect(validateKioskSopManifest(manifest)).toBe(manifest);
    expect(() => validateKioskSopManifest({
      ...manifest,
      artifacts: { '../outside.png': digest }
    })).toThrow(/repository-relative/);
    expect(() => validateKioskSopManifest({
      ...manifest,
      sourceSha256: 'not-a-digest'
    })).toThrow(/sourceSha256/);
  });
});
