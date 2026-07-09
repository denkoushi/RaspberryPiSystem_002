import { describe, expect, it } from 'vitest';

import { toggleExpandedId } from './assemblyRowExpansion';

describe('toggleExpandedId', () => {
  it('starts closed and expands an id', () => {
    const next = toggleExpandedId(new Set(), 'lot-1');
    expect(next.has('lot-1')).toBe(true);
    expect(next.size).toBe(1);
  });

  it('collapses an expanded id without mutating the previous set', () => {
    const prev = new Set(['lot-1', 'lot-2']);
    const next = toggleExpandedId(prev, 'lot-1');
    expect(prev.has('lot-1')).toBe(true);
    expect(next.has('lot-1')).toBe(false);
    expect(next.has('lot-2')).toBe(true);
  });
});
