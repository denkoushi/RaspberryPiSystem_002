import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCAW_MODE_STORAGE_KEY, usePersistedPlanningBoardScawMode } from './usePersistedPlanningBoardScawMode';

describe('planning board SCAW persistence', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  it('defaults off, persists the toggle and restores it', () => {
    const first = renderHook(usePersistedPlanningBoardScawMode);
    expect(first.result.current.scawEnabled).toBe(false);
    act(() => first.result.current.toggleScawMode());
    expect(JSON.parse(localStorage.getItem(SCAW_MODE_STORAGE_KEY)!)).toEqual({ schemaVersion: 1, enabled: true });
    first.unmount();
    expect(renderHook(usePersistedPlanningBoardScawMode).result.current.scawEnabled).toBe(true);
  });
  it('ignores corrupt or unsupported values', () => {
    localStorage.setItem(SCAW_MODE_STORAGE_KEY, 'bad json');
    expect(renderHook(usePersistedPlanningBoardScawMode).result.current.scawEnabled).toBe(false);
    localStorage.setItem(SCAW_MODE_STORAGE_KEY, '{"schemaVersion":2,"enabled":true}');
    expect(renderHook(usePersistedPlanningBoardScawMode).result.current.scawEnabled).toBe(false);
  });
  it('keeps working when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(usePersistedPlanningBoardScawMode);
    expect(result.current.scawEnabled).toBe(false);
    act(() => result.current.toggleScawMode());
    expect(result.current.scawEnabled).toBe(true);
  });
});
