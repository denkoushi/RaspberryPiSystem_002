import { describe, expect, it } from 'vitest';

import { procedureContentSchema, procedureHeaderSchema, procedureImageIds } from '../procedure-content.js';

const image = 'a'.repeat(64);
const step = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, title: '治具を準備する', body: '治具Bを出して受け面を拭く。', cautions: [], needsReview: [],
  photos: [{ imageId: image, caption: '治具B' }],
  sources: [{ kind: 'note', ref: '123e4567-e89b-42d3-a456-426614174000', label: 'メモ 2026/09/20', quote: '治具Bは受け面を拭いてから' }],
  ...overrides,
});

describe('procedure content contract', () => {
  it('accepts ordered steps that all carry provenance', () => {
    const content = procedureContentSchema.parse({ formatVersion: 1, steps: [step('s1'), step('s2', { photos: [] })] });
    expect(content.steps.map(value => value.id)).toEqual(['s1', 's2']);
    expect(procedureImageIds(content)).toEqual(new Set([image]));
  });

  it('rejects a step without a source', () => {
    expect(() => procedureContentSchema.parse({ formatVersion: 1, steps: [step('s1', { sources: [] })] })).toThrow();
  });

  it('rejects duplicate step ids, empty procedures and non-asset image references', () => {
    expect(() => procedureContentSchema.parse({ formatVersion: 1, steps: [step('s1'), step('s1')] })).toThrow('Duplicate step id');
    expect(() => procedureContentSchema.parse({ formatVersion: 1, steps: [] })).toThrow();
    expect(() => procedureContentSchema.parse({ formatVersion: 1, steps: [step('s1', { photos: [{ imageId: 'https://example.com/a.jpg', caption: '' }] })] })).toThrow();
  });

  it('rejects unknown fields so model output cannot smuggle markup or URLs', () => {
    expect(() => procedureContentSchema.parse({ formatVersion: 1, steps: [step('s1', { html: '<b>x</b>' })] })).toThrow();
  });

  it('validates the header review tier', () => {
    const header = { title: '部品Aの段取り', category: '段取り手順', identifiers: { partNumber: 'SAMPLE-0001' }, reviewTier: 'approval_required' };
    expect(procedureHeaderSchema.parse(header).reviewTier).toBe('approval_required');
    expect(() => procedureHeaderSchema.parse({ ...header, reviewTier: 'skip' })).toThrow();
  });
});
