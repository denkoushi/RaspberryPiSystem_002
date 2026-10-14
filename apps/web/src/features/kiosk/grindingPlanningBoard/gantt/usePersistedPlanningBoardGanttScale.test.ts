import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GANTT_SCALE_STORAGE_KEY, usePersistedPlanningBoardGanttScale } from './usePersistedPlanningBoardGanttScale';

describe('usePersistedPlanningBoardGanttScale', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  it('既定は2週、変更を端末へ保存し次回復元する', () => {
    const first = renderHook(usePersistedPlanningBoardGanttScale);
    expect(first.result.current.scale).toBe(14);
    act(() => first.result.current.changeScale(28));
    expect(JSON.parse(localStorage.getItem(GANTT_SCALE_STORAGE_KEY)!)).toEqual({ schemaVersion: 1, days: 28 });
    first.unmount();
    expect(renderHook(usePersistedPlanningBoardGanttScale).result.current.scale).toBe(28);
  });
  it.each(['{', 'null', '{"schemaVersion":2,"days":7}', '{"schemaVersion":1,"days":30}'])('不正な保存値を無視する: %s', (saved) => {
    localStorage.setItem(GANTT_SCALE_STORAGE_KEY, saved);
    expect(renderHook(usePersistedPlanningBoardGanttScale).result.current.scale).toBe(14);
  });
  it('ストレージが使えなくても表示と変更ができる', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(usePersistedPlanningBoardGanttScale);
    expect(result.current.scale).toBe(14);
    act(() => result.current.changeScale(56));
    expect(result.current.scale).toBe(56);
  });
});
