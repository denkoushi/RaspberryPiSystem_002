import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SEARCH_CONDITIONS,
  SEARCH_CONDITIONS_SCHEMA_VERSION,
  SEARCH_CONDITIONS_STORAGE_KEY
} from './searchConditions';
import { useProductionScheduleSearchConditions } from './useProductionScheduleSearchConditions';

describe('useProductionScheduleSearchConditions', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  it('localStorage から初期値を復元する', () => {
    window.localStorage.setItem(
      SEARCH_CONDITIONS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SEARCH_CONDITIONS_SCHEMA_VERSION,
        conditions: {
          ...DEFAULT_SEARCH_CONDITIONS,
          inputQuery: 'SEIBAN-001',
          hasNoteOnlyFilter: true,
          selectedMachineName: 'MACHINE-A',
          selectedPartName: 'PART-A'
        }
      })
    );

    const { result, unmount } = renderHook(() => useProductionScheduleSearchConditions());

    expect(result.current[0].inputQuery).toBe('SEIBAN-001');
    expect(result.current[0].hasNoteOnlyFilter).toBe(true);
    expect(result.current[0].selectedMachineName).toBe('MACHINE-A');
    expect(result.current[0].selectedPartName).toBe('PART-A');
    unmount();
  });

  it('条件変更時に debounce 後 localStorage へ保存する', () => {
    const { result, unmount } = renderHook(() => useProductionScheduleSearchConditions());

    act(() => {
      result.current[1]({
        inputQuery: 'M12345',
        activeQueries: ['M12345'],
        hasDueDateOnlyFilter: true,
        selectedMachineName: 'MACHINE-B',
        selectedPartName: 'PART-B'
      });
    });

    expect(window.localStorage.getItem(SEARCH_CONDITIONS_STORAGE_KEY)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    const stored = window.localStorage.getItem(SEARCH_CONDITIONS_STORAGE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored ?? '{}') as {
      schemaVersion: number;
      conditions: {
        inputQuery: string;
        activeQueries: string[];
        hasDueDateOnlyFilter: boolean;
        selectedMachineName: string;
        selectedPartName: string;
      };
    };

    expect(parsed.schemaVersion).toBe(SEARCH_CONDITIONS_SCHEMA_VERSION);
    expect(parsed.conditions.inputQuery).toBe('M12345');
    expect(parsed.conditions.activeQueries).toEqual(['M12345']);
    expect(parsed.conditions.hasDueDateOnlyFilter).toBe(true);
    expect(parsed.conditions.selectedMachineName).toBe('MACHINE-B');
    expect(parsed.conditions.selectedPartName).toBe('PART-B');
    unmount();
  });
});
