import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelfInspectionWorkInstructions } from './useSelfInspectionWorkInstructions';

const { useGroupsMock, useGroupMock } = vi.hoisted(() => ({
  useGroupsMock: vi.fn(),
  useGroupMock: vi.fn()
}));

vi.mock('../../api/hooks', () => ({
  useWorkInstructionGroups: useGroupsMock,
  useWorkInstructionGroup: useGroupMock
}));

describe('useSelfInspectionWorkInstructions', () => {
  beforeEach(() => {
    useGroupsMock.mockReset();
    useGroupMock.mockReset();
    useGroupsMock.mockReturnValue({ data: undefined, isFetching: false });
    useGroupMock.mockReturnValue({ data: undefined });
  });

  it('keeps current chips during a background refetch and clears them when a new scan begins', () => {
    const groups = [
      { shootingTarget: '581' },
      { shootingTarget: '研削' }
    ];
    useGroupsMock.mockImplementation((partNumber: string) => ({
      data: partNumber === 'PART-1' ? groups : undefined,
      isFetching: partNumber === 'PART-1'
    }));

    const { result } = renderHook(() => useSelfInspectionWorkInstructions());

    act(() => {
      result.current.acceptPartScan(' part-1 ');
    });
    expect(result.current.targets).toEqual(['研削', '581']);

    act(() => {
      result.current.beginPartScan();
    });
    expect(result.current.targets).toEqual([]);
  });
});
