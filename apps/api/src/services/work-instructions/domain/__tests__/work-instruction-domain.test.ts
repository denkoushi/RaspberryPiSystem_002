import { describe, expect, it } from 'vitest';

import {
  parseWorkInstructionManifest,
  WorkInstructionManifestError,
} from '../manifest.js';
import {
  normalizeWorkInstructionGroupKey,
  normalizeWorkInstructionImageName,
  normalizeWorkInstructionPartNumber,
  normalizeWorkInstructionShootingTarget,
  normalizeWorkInstructionSourceIdentity,
  normalizeWorkInstructionText,
} from '../normalization.js';
import {
  computeWorkInstructionContentHash,
  decideWorkInstructionRevision,
} from '../update-policy.js';

const source = {
  system: 'SharePoint',
  list: 'WorkInstructions Ａ',
  item_id: 640,
  modified: '2026-08-29T01:02:03+09:00',
};

const baseManifest = {
  schema_version: 1,
  source,
  part_number: ' md004121632 ',
  shooting_target: '研削工程',
  steps: [{ step: 1, text: 'Inspect', image: '640_photo_1.jpeg' }],
};

function manifestWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...baseManifest, ...overrides };
}

describe('work-instruction normalization', () => {
  it('normalizes external text and the agreed grouping aliases', () => {
    expect(normalizeWorkInstructionText(' ＡＢＣ　 ')).toBe('ABC');
    expect(normalizeWorkInstructionPartNumber(' md004121632 ')).toBe('MD004121632');
    expect(normalizeWorkInstructionPartNumber('  ')).toBeNull();
    expect(normalizeWorkInstructionShootingTarget('研削工程')).toBe('研削');
    expect(normalizeWorkInstructionShootingTarget('切削')).toBe('切削');
    // 305 is classified as a grinding resource by the existing production
    // schedule policy, but an individual resource remains its own group key.
    expect(normalizeWorkInstructionShootingTarget('305')).toBe('305');
    expect(normalizeWorkInstructionShootingTarget('305')).not.toBe(
      normalizeWorkInstructionShootingTarget('研削工程')
    );
    expect(normalizeWorkInstructionShootingTarget(' machine-a ')).toBe('MACHINE-A');
  });

  it('preserves exact source tokens so fullwidth and ordinary list names remain distinct', () => {
    const fullwidth = normalizeWorkInstructionSourceIdentity({
      system: 'SharePoint',
      list: '工程リストＡ',
      itemId: 640,
    });
    const ordinary = normalizeWorkInstructionSourceIdentity({
      system: 'SharePoint',
      list: '工程リストA',
      itemId: 640,
    });
    expect(fullwidth.list).not.toBe(ordinary.list);
    expect(() => normalizeWorkInstructionSourceIdentity({ system: ' ', list: 'A', itemId: 1 })).toThrow(
      'source.system must not be empty'
    );
    expect(() => normalizeWorkInstructionSourceIdentity({ system: 'S', list: '', itemId: 1 })).toThrow(
      'source.list must not be empty'
    );
  });

  it('returns no group key when either classification field is missing', () => {
    expect(normalizeWorkInstructionGroupKey(null, '研削')).toBeNull();
    expect(normalizeWorkInstructionGroupKey('MD004', undefined)).toBeNull();
    expect(normalizeWorkInstructionGroupKey(' MD004 ', '研削工程')).toEqual({
      partNumber: 'MD004',
      shootingTarget: '研削',
    });
  });

  it('does not rewrite attachment filenames', () => {
    expect(normalizeWorkInstructionImageName(' 640_photo_1.jpeg ')).toBe(' 640_photo_1.jpeg ');
  });
});

describe('parseWorkInstructionManifest', () => {
  it('parses the fixture source tuple and preserves raw JSON including __proto__', () => {
    const input = JSON.parse(JSON.stringify({ ...baseManifest, source })) as Record<string, unknown>;
    Object.defineProperty(input, '__proto__', {
      value: { producer: 'Power Automate' },
      enumerable: true,
      configurable: true,
    });
    const parsed = parseWorkInstructionManifest(input);
    const raw = parsed.rawManifest as Record<string, unknown>;

    expect(parsed.source).toMatchObject({
      system: 'SharePoint',
      list: 'WorkInstructions Ａ',
      itemId: 640,
    });
    expect(parsed.source.modified.toISOString()).toBe('2026-08-28T16:02:03.000Z');
    expect(parsed.partNumber).toBe('MD004121632');
    expect(parsed.shootingTarget).toBe('研削');
    expect(Object.prototype.hasOwnProperty.call(raw, '__proto__')).toBe(true);
    expect((raw.__proto__ as Record<string, unknown>).producer).toBe('Power Automate');
  });

  it('allows an empty step list, null image, and one image reused by multiple steps', () => {
    expect(parseWorkInstructionManifest(manifestWith({ steps: [] })).steps).toEqual([]);
    const parsed = parseWorkInstructionManifest(
      manifestWith({
        steps: [
          { step: 1, text: 'before', image: null },
          { step: 2, text: 'after', image: '640_photo_1.jpeg' },
          { step: 3, text: 'repeat', image: '640_photo_1.jpeg' },
        ],
      })
    );
    expect(parsed.steps.map((step) => step.imageName)).toEqual([
      null,
      '640_photo_1.jpeg',
      '640_photo_1.jpeg',
    ]);
  });

  it('rejects invalid version/source/date and duplicate or empty steps', () => {
    expect(() => parseWorkInstructionManifest(manifestWith({ schema_version: 2 }))).toThrow(
      'schema_version must be 1'
    );
    expect(() => parseWorkInstructionManifest(manifestWith({ source: { ...source, list: ' ' } }))).toThrow(
      'source.list must not be empty'
    );
    expect(() => parseWorkInstructionManifest(manifestWith({ source: { ...source, modified: '2026-08-29' } }))).toThrow(
      'source.modified must include a timezone'
    );
    expect(() => parseWorkInstructionManifest(manifestWith({ source: { ...source, modified: 'not-a-dateZ' } }))).toThrow(
      'source.modified must be a valid date'
    );
    expect(() => parseWorkInstructionManifest(manifestWith({
      steps: [
        { step: 1, text: 'one', image: null },
        { step: 1, text: 'duplicate', image: null },
      ],
    }))).toThrow('steps contains duplicate step 1');
    expect(() => parseWorkInstructionManifest(manifestWith({
      steps: [{ step: 1, text: 'empty image', image: '   ' }],
    }))).toThrow('steps[0].image must not be empty');
    expect(() => parseWorkInstructionManifest(manifestWith({
      steps: [{ step: 1, image: null }],
    }))).toThrow(WorkInstructionManifestError);
  });
});

describe('work-instruction content hash and revision policy', () => {
  const imageA = { imageName: '640_photo_1.jpeg', sha256: 'a'.repeat(64) };
  const imageB = { imageName: '640_photo_2.jpeg', sha256: 'b'.repeat(64) };
  const modified = new Date('2026-08-29T00:00:00.000Z');

  it('is stable across object and image order but changes with content', () => {
    const first = computeWorkInstructionContentHash(
      { z: 1, a: { second: true, first: 'x' } },
      [imageA, imageB]
    );
    const reordered = computeWorkInstructionContentHash(
      { a: { first: 'x', second: true }, z: 1 },
      [imageB, imageA]
    );
    const changed = computeWorkInstructionContentHash(
      { z: 1, a: { second: true, first: 'changed' } },
      [imageA, imageB]
    );
    expect(first).toBe(reordered);
    expect(first).not.toBe(changed);
    expect(() => computeWorkInstructionContentHash({ ok: true }, [imageA, { ...imageA, sha256: 'c'.repeat(64) }])).toThrow(
      'has conflicting digests'
    );
  });

  it('applies, deduplicates, stales, or conflicts strictly by modified then content hash', () => {
    const same = { modified, contentHash: 'same' };
    expect(decideWorkInstructionRevision(null, same)).toBe('APPLY');
    expect(decideWorkInstructionRevision(same, { modified: new Date(modified.getTime() + 1), contentHash: 'new' })).toBe(
      'APPLY'
    );
    expect(decideWorkInstructionRevision(same, { modified: new Date(modified.getTime() - 1), contentHash: 'old' })).toBe(
      'STALE'
    );
    expect(decideWorkInstructionRevision(same, { modified, contentHash: 'same' })).toBe('DUPLICATE');
    expect(decideWorkInstructionRevision(same, { modified, contentHash: 'different' })).toBe('CONFLICT');
  });
});
