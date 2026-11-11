import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePersistedPlanningBoardSingleResource } from './usePersistedPlanningBoardSingleResource';

const key = (scope: string) => `kiosk.planning-board.single-resource:${scope}`;
describe('usePersistedPlanningBoardSingleResource', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  it('persists per site/category, restores on mount and removes the key on exit', () => {
    const first = renderHook(() => usePersistedPlanningBoardSingleResource('site:cutting', ['305', '306']));
    expect(first.result.current.resourceCd).toBeNull();
    act(() => first.result.current.changeResource('305'));
    expect(JSON.parse(localStorage.getItem(key('site:cutting'))!)).toEqual({ schemaVersion: 1, resourceCd: '305' });
    first.unmount();
    const { result, rerender } = renderHook(({ scope }) => usePersistedPlanningBoardSingleResource(scope, ['305', '306']), { initialProps: { scope: 'site:cutting' } });
    expect(result.current.resourceCd).toBe('305');
    rerender({ scope: 'site:grinding' });
    expect(result.current.resourceCd).toBeNull();
    act(() => result.current.changeResource('306'));
    rerender({ scope: 'site:cutting' });
    expect(result.current.resourceCd).toBe('305');
    act(() => result.current.changeResource(null));
    expect(localStorage.getItem(key('site:cutting'))).toBeNull();
    expect(localStorage.getItem(key('site:grinding'))).not.toBeNull();
    expect(renderHook(() => usePersistedPlanningBoardSingleResource('site:cutting', ['305'])).result.current.resourceCd).toBeNull();
  });
  it.each(['{', 'null', '{"schemaVersion":2,"resourceCd":"305"}', '{"schemaVersion":1,"resourceCd":305}', '{"schemaVersion":1,"resourceCd":"missing"}'])('ignores invalid or absent lanes: %s', (saved) => {
    localStorage.setItem(key('site:all'), saved);
    expect(renderHook(() => usePersistedPlanningBoardSingleResource('site:all', ['305'])).result.current.resourceCd).toBeNull();
  });
  it('restores after lanes load and ignores a lane removed from the current data', () => {
    localStorage.setItem(key('site:all'), JSON.stringify({ schemaVersion: 1, resourceCd: '305' }));
    const { result, rerender } = renderHook(({ resources }) => usePersistedPlanningBoardSingleResource('site:all', resources), { initialProps: { resources: [] as string[] } });
    expect(result.current.resourceCd).toBeNull();
    rerender({ resources: ['305'] });
    expect(result.current.resourceCd).toBe('305');
    rerender({ resources: ['306'] });
    expect(result.current.resourceCd).toBeNull();
  });
  it('tolerates read, write and removal failures', () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => usePersistedPlanningBoardSingleResource('site:all', ['305']));
    expect(result.current.resourceCd).toBeNull();
    act(() => result.current.changeResource('305'));
    expect(result.current.resourceCd).toBe('305');
    act(() => result.current.changeResource(null));
    expect(result.current.resourceCd).toBeNull();
  });
});

it.each(['021', '022'])('persists and restores the pair, deselecting when %s disappears', (missing) => {
  localStorage.clear();
  const first = renderHook(() => usePersistedPlanningBoardSingleResource('site:cutting', ['021', '022']));
  act(() => first.result.current.changeResource('021+022'));
  expect(JSON.parse(localStorage.getItem(key('site:cutting'))!)).toEqual({ schemaVersion: 1, resourceCd: '021+022' });
  first.unmount();
  const { result, rerender } = renderHook(({ resources }) => usePersistedPlanningBoardSingleResource('site:cutting', resources),
    { initialProps: { resources: ['021', '022'] } });
  expect(result.current.resourceCd).toBe('021+022');
  rerender({ resources: ['021', '022'].filter((resource) => resource !== missing) });
  expect(result.current.resourceCd).toBeNull();
});

it.each(['021+022', '305+306', '306+305'])('reads an existing schema-1 selection %s without migration', selection => {
  localStorage.clear();
  localStorage.setItem(key('site:all'), JSON.stringify({ schemaVersion: 1, resourceCd: selection }));
  const { result } = renderHook(() => usePersistedPlanningBoardSingleResource('site:all', ['021', '022', '305', '306']));
  expect(result.current.resourceCd).toBe(selection);
});


it('restores a literal + resource code before considering a pair', () => {
  localStorage.setItem(key('literal'), JSON.stringify({ schemaVersion: 1, resourceCd: '305+306' }));
  const { result } = renderHook(() => usePersistedPlanningBoardSingleResource('literal', ['305+306']));
  expect(result.current.resourceCd).toBe('305+306');
});
