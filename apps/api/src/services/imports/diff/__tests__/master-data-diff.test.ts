import { describe, expect, it } from 'vitest';

import { buildUpdateDiff } from '../master-data-diff.js';

describe('buildUpdateDiff', () => {
  it('returns only changed keys', () => {
    const diff = buildUpdateDiff({ name: 'A', status: 'AVAILABLE', notes: null }, { name: 'B', status: 'AVAILABLE', notes: null });
    expect(diff).toEqual({ data: { name: 'B' }, hasChanges: true });
  });

  it('reports no changes for identical primitives', () => {
    expect(buildUpdateDiff({ name: 'A', qty: 1 }, { name: 'A', qty: 1 })).toEqual({ data: {}, hasChanges: false });
  });

  it('ignores keys present only on the existing record', () => {
    expect(buildUpdateDiff({ id: 'x', name: 'A' }, { name: 'A' })).toEqual({ data: {}, hasChanges: false });
  });

  it('treats null -> "" as a change but skips undefined (Prisma means "leave as is")', () => {
    const diff = buildUpdateDiff<Record<string, unknown>>({ a: null, b: null, c: 'x' }, { a: '', b: undefined, c: undefined });
    expect(diff.hasChanges).toBe(true);
    expect(diff.data).toEqual({ a: '' });
    expect(Object.keys(diff.data)).toEqual(['a']);
  });

  it('treats null and undefined on the existing side as the same empty value', () => {
    expect(buildUpdateDiff<Record<string, unknown>>({ a: null }, { a: null }).hasChanges).toBe(false);
    expect(buildUpdateDiff<Record<string, unknown>>({}, { a: null }).hasChanges).toBe(false);
    expect(buildUpdateDiff<Record<string, unknown>>({ a: 'x' }, { a: null })).toEqual({ data: { a: null }, hasChanges: true });
  });

  it('treats an absent existing key as matching an explicit undefined', () => {
    expect(buildUpdateDiff<Record<string, unknown>>({}, { a: undefined }).hasChanges).toBe(false);
  });

  it('uses Object.is semantics: NaN equals NaN, +0 differs from -0', () => {
    expect(buildUpdateDiff({ v: Number.NaN }, { v: Number.NaN }).hasChanges).toBe(false);
    expect(buildUpdateDiff({ v: 0 }, { v: -0 }).hasChanges).toBe(true);
  });

  it('compares Date values by timestamp, so re-importing the same date is not a change', () => {
    const existing = new Date('2026-01-01T00:00:00Z');
    expect(buildUpdateDiff({ d: existing }, { d: existing }).hasChanges).toBe(false);
    expect(buildUpdateDiff({ d: existing }, { d: new Date('2026-01-01T00:00:00Z') }).hasChanges).toBe(false);
    expect(buildUpdateDiff({ d: existing }, { d: new Date('2026-01-01T00:00:00.001Z') })).toEqual({
      data: { d: new Date('2026-01-01T00:00:00.001Z') },
      hasChanges: true,
    });
    expect(buildUpdateDiff<Record<string, unknown>>({ d: null }, { d: existing })).toEqual({ data: { d: existing }, hasChanges: true });
  });
});
