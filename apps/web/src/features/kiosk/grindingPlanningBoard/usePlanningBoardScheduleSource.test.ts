import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEDULE_SOURCE_STORAGE_KEY, usePlanningBoardScheduleSource } from './usePlanningBoardScheduleSource';

describe('usePlanningBoardScheduleSource', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('defaults to both without a saved preference', () => {
    expect(renderHook(usePlanningBoardScheduleSource).result.current.scheduleSource).toBe('both');
  });

  it.each(['general', 'dCompany', 'both'] as const)('persists and restores %s', (scheduleSource) => {
    const first = renderHook(usePlanningBoardScheduleSource);
    act(() => first.result.current.changeScheduleSource(scheduleSource));
    expect(first.result.current.scheduleSource).toBe(scheduleSource);
    expect(JSON.parse(localStorage.getItem(SCHEDULE_SOURCE_STORAGE_KEY)!)).toEqual({ schemaVersion: 1, scheduleSource });
    first.unmount();
    expect(renderHook(usePlanningBoardScheduleSource).result.current.scheduleSource).toBe(scheduleSource);
  });

  it.each(['{', 'null', '{"schemaVersion":2,"scheduleSource":"general"}', '{"schemaVersion":1}', '{"schemaVersion":1,"scheduleSource":"unknown"}', '{"schemaVersion":1,"scheduleSource":true}'])('ignores invalid storage: %s', (saved) => {
    localStorage.setItem(SCHEDULE_SOURCE_STORAGE_KEY, saved);
    expect(renderHook(usePlanningBoardScheduleSource).result.current.scheduleSource).toBe('both');
  });

  it('keeps the current selection when storage reads and writes fail', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(usePlanningBoardScheduleSource);
    expect(result.current.scheduleSource).toBe('both');
    act(() => result.current.changeScheduleSource('general'));
    expect(result.current.scheduleSource).toBe('general');
    act(() => result.current.changeScheduleSource('dCompany'));
    expect(result.current.scheduleSource).toBe('dCompany');
  });
});
