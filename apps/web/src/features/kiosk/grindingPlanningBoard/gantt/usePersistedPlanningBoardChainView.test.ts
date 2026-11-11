import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAIN_VIEW_STORAGE_KEY, usePersistedPlanningBoardChainView } from './usePersistedPlanningBoardChainView';

describe('usePersistedPlanningBoardChainView', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  it('defaults to pieces and restores the terminal selection', () => {
    const first = renderHook(usePersistedPlanningBoardChainView);
    expect(first.result.current.view).toBe('pieces');
    act(() => first.result.current.changeView('process'));
    expect(JSON.parse(localStorage.getItem(CHAIN_VIEW_STORAGE_KEY)!)).toEqual({ schemaVersion: 1, view: 'process' });
    first.unmount();
    expect(renderHook(usePersistedPlanningBoardChainView).result.current.view).toBe('process');
  });
  it.each(['{', 'null', '{"schemaVersion":2,"view":"process"}', '{"schemaVersion":1,"view":"invalid"}'])('ignores invalid storage: %s', (saved) => {
    localStorage.setItem(CHAIN_VIEW_STORAGE_KEY, saved);
    expect(renderHook(usePersistedPlanningBoardChainView).result.current.view).toBe('pieces');
  });
  it('works when storage reads and writes fail', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(usePersistedPlanningBoardChainView);
    expect(result.current.view).toBe('pieces');
    act(() => result.current.changeView('process'));
    expect(result.current.view).toBe('process');
  });
});
