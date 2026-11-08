import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CATEGORY_STORAGE_KEY, usePlanningBoardCategory } from './usePlanningBoardCategory';

describe('usePlanningBoardCategory', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('defaults to grinding without a saved preference', () => {
    expect(renderHook(usePlanningBoardCategory).result.current.category).toBe('grinding');
  });

  it.each(['cutting', 'all', 'grinding'] as const)('persists and restores %s', (category) => {
    const first = renderHook(usePlanningBoardCategory);
    act(() => first.result.current.changeCategory(category));
    expect(first.result.current.category).toBe(category);
    expect(JSON.parse(localStorage.getItem(CATEGORY_STORAGE_KEY)!)).toEqual({ schemaVersion: 1, category });
    first.unmount();
    expect(renderHook(usePlanningBoardCategory).result.current.category).toBe(category);
  });

  it.each(['{', 'null', '{"schemaVersion":2,"category":"cutting"}', '{"schemaVersion":1}', '{"schemaVersion":1,"category":"unknown"}', '{"schemaVersion":1,"category":true}'])('ignores invalid storage: %s', (saved) => {
    localStorage.setItem(CATEGORY_STORAGE_KEY, saved);
    expect(renderHook(usePlanningBoardCategory).result.current.category).toBe('grinding');
  });

  it('keeps the current selection when storage reads and writes fail', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(usePlanningBoardCategory);
    expect(result.current.category).toBe('grinding');
    act(() => result.current.changeCategory('cutting'));
    expect(result.current.category).toBe('cutting');
    act(() => result.current.changeCategory('all'));
    expect(result.current.category).toBe('all');
  });
});
