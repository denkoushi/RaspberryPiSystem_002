import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useProductionScheduleQueryParams } from './useProductionScheduleQueryParams';

describe('useProductionScheduleQueryParams', () => {
  it('機種名 + 工程 + 資源CDで hasQuery=true になる', () => {
    const { result } = renderHook(() =>
      useProductionScheduleQueryParams({
        activeQueries: [],
        activeResourceCds: ['305'],
        activeResourceAssignedOnlyCds: [],
        hasNoteOnlyFilter: false,
        hasDueDateOnlyFilter: false,
        showGrindingResources: true,
        showCuttingResources: false,
        selectedMachineName: 'MACHINE-A',
        history: []
      })
    );

    expect(result.current.hasQuery).toBe(true);
    expect(result.current.queryParams.machineName).toBe('MACHINE-A');
    expect(result.current.queryParams.resourceCategory).toBe('grinding');
  });

  it('工程 + 資源CDのみ（機種名未選択）では hasQuery=false のまま', () => {
    const { result } = renderHook(() =>
      useProductionScheduleQueryParams({
        activeQueries: [],
        activeResourceCds: ['305'],
        activeResourceAssignedOnlyCds: [],
        hasNoteOnlyFilter: false,
        hasDueDateOnlyFilter: false,
        showGrindingResources: true,
        showCuttingResources: false,
        selectedMachineName: '',
        history: []
      })
    );

    expect(result.current.hasQuery).toBe(false);
    expect(result.current.queryParams.machineName).toBeUndefined();
  });

  it('既存の登録製番検索条件は従来どおり有効', () => {
    const { result } = renderHook(() =>
      useProductionScheduleQueryParams({
        activeQueries: ['SEIBAN-001'],
        activeResourceCds: [],
        activeResourceAssignedOnlyCds: [],
        hasNoteOnlyFilter: false,
        hasDueDateOnlyFilter: false,
        showGrindingResources: false,
        showCuttingResources: false,
        selectedMachineName: '',
        history: ['SEIBAN-001']
      })
    );

    expect(result.current.hasQuery).toBe(true);
    expect(result.current.queryParams.q).toBe('SEIBAN-001');
  });
});
