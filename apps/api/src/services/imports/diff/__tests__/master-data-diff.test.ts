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

  it('treats null -> "" and null -> undefined as changes', () => {
    const diff = buildUpdateDiff<Record<string, unknown>>({ a: null, b: null }, { a: '', b: undefined });
    expect(diff.hasChanges).toBe(true);
    expect(diff.data).toEqual({ a: '', b: undefined });
    expect(Object.keys(diff.data)).toEqual(['a', 'b']);
  });

  it('treats an absent existing key as matching an explicit undefined', () => {
    expect(buildUpdateDiff<Record<string, unknown>>({}, { a: undefined }).hasChanges).toBe(false);
  });

  it('uses Object.is semantics: NaN equals NaN, +0 differs from -0', () => {
    expect(buildUpdateDiff({ v: Number.NaN }, { v: Number.NaN }).hasChanges).toBe(false);
    expect(buildUpdateDiff({ v: 0 }, { v: -0 }).hasChanges).toBe(true);
  });

  it('compares Date values by identity, so equal timestamps still count as a change', () => {
    const existing = new Date('2026-01-01T00:00:00Z');
    expect(buildUpdateDiff({ d: existing }, { d: existing }).hasChanges).toBe(false);
    // NOTE: possible bug: importers pass freshly parsed Date objects, so re-importing the same date is always a "change".
    expect(buildUpdateDiff({ d: existing }, { d: new Date('2026-01-01T00:00:00Z') })).toEqual({
      data: { d: new Date('2026-01-01T00:00:00Z') },
      hasChanges: true,
    });
  });
});
