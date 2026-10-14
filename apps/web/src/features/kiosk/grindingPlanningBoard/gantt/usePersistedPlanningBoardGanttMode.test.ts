import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GANTT_MODE_STORAGE_KEY, usePersistedPlanningBoardGanttMode } from './usePersistedPlanningBoardGanttMode';

describe('usePersistedPlanningBoardGanttMode', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  it('defaults to forward and restores the terminal selection', () => {
    const first = renderHook(usePersistedPlanningBoardGanttMode);
    expect(first.result.current.mode).toBe('forward');
    act(() => first.result.current.changeMode('backward'));
    expect(JSON.parse(localStorage.getItem(GANTT_MODE_STORAGE_KEY)!)).toEqual({ schemaVersion: 1, mode: 'backward' });
    first.unmount();
    expect(renderHook(usePersistedPlanningBoardGanttMode).result.current.mode).toBe('backward');
  });
  it.each(['{', 'null', '{"schemaVersion":2,"mode":"backward"}', '{"schemaVersion":1,"mode":"invalid"}'])('ignores invalid storage: %s', (saved) => {
    localStorage.setItem(GANTT_MODE_STORAGE_KEY, saved);
    expect(renderHook(usePersistedPlanningBoardGanttMode).result.current.mode).toBe('forward');
  });
  it('works when storage reads and writes fail', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(usePersistedPlanningBoardGanttMode);
    expect(result.current.mode).toBe('forward');
    act(() => result.current.changeMode('backward'));
    expect(result.current.mode).toBe('backward');
  });
});
