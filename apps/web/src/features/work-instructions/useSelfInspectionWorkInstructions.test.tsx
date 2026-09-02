import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelfInspectionWorkInstructions } from './useSelfInspectionWorkInstructions';

const { useGroupsMock, useGroupMock, getAliasMock, getCandidatesMock, putAliasMock } = vi.hoisted(() => ({
  useGroupsMock: vi.fn(),
  useGroupMock: vi.fn(),
  getAliasMock: vi.fn(),
  getCandidatesMock: vi.fn(),
  putAliasMock: vi.fn()
}));

vi.mock('../../api/hooks', () => ({
  useWorkInstructionGroups: useGroupsMock,
  useWorkInstructionGroup: useGroupMock
}));

vi.mock('../../api/client', () => ({
  getWorkInstructionPartAlias: (...args: unknown[]) => getAliasMock(...args),
  getWorkInstructionPartCandidates: (...args: unknown[]) => getCandidatesMock(...args),
  putWorkInstructionPartAlias: (...args: unknown[]) => putAliasMock(...args)
}));

describe('useSelfInspectionWorkInstructions', () => {
  beforeEach(() => {
    useGroupsMock.mockReset();
    useGroupMock.mockReset();
    getAliasMock.mockReset();
    getCandidatesMock.mockReset();
    putAliasMock.mockReset();
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

  it('settles exact resolution when the groups query fails', async () => {
    useGroupsMock.mockImplementation((partNumber: string) => ({
      data: undefined,
      isFetching: false,
      isSuccess: false,
      isError: Boolean(partNumber)
    }));

    const { result } = renderHook(() => useSelfInspectionWorkInstructions());

    act(() => {
      result.current.acceptPartScan('PART-1');
    });

    await waitFor(() => expect(result.current.autoFallbackPending).toBe(false));
    expect(getAliasMock).not.toHaveBeenCalled();
    expect(getCandidatesMock).not.toHaveBeenCalled();
  });

  it('settles canonical resolution when the learned target query fails', async () => {
    useGroupsMock.mockImplementation((partNumber: string) => ({
      data: partNumber === 'MH001' ? undefined : [],
      isFetching: false,
      isSuccess: partNumber !== 'MH001' && Boolean(partNumber),
      isError: partNumber === 'MH001'
    }));
    getAliasMock.mockResolvedValue({
      scannedPartNumber: 'MH009X',
      canonicalPartNumber: 'MH001',
      partName: null,
      shootingTargets: [],
      selectionCount: 1,
      createdAt: '2026-09-02T00:00:00.000Z',
      lastSelectedAt: '2026-09-02T00:00:00.000Z'
    });

    const { result } = renderHook(() => useSelfInspectionWorkInstructions());

    act(() => {
      result.current.acceptPartScan('MH009X');
    });

    await waitFor(() => expect(getAliasMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.autoFallbackPending).toBe(false));
    expect(result.current.similarMatch).toEqual({
      scannedPartNumber: 'MH009X',
      canonicalPartNumber: 'MH001'
    });
    expect(getCandidatesMock).not.toHaveBeenCalled();
  });

  it('serializes alias saves so a late first selection cannot overwrite the second', async () => {
    useGroupsMock.mockReturnValue({
      data: [],
      isFetching: false,
      isSuccess: true,
      isError: false
    });
    let resolveFirstSave!: () => void;
    const firstSaveComplete = new Promise<void>((resolve) => {
      resolveFirstSave = resolve;
    });
    const updateOrder: string[] = [];
    putAliasMock.mockImplementation(async ({ canonicalPartNumber }: { canonicalPartNumber: string }) => {
      updateOrder.push(canonicalPartNumber);
      if (canonicalPartNumber === 'MH001') await firstSaveComplete;
    });

    const { result } = renderHook(() => useSelfInspectionWorkInstructions());

    act(() => {
      result.current.acceptPartScan('MH009X', { autoFallback: false });
    });
    act(() => {
      result.current.selectCandidate('MH001');
    });
    await waitFor(() => expect(updateOrder).toEqual(['MH001']));

    act(() => {
      result.current.selectCandidate('MH002');
    });
    // The second PUT is held behind the unresolved first PUT.
    expect(updateOrder).toEqual(['MH001']);

    await act(async () => {
      resolveFirstSave();
    });
    await waitFor(() => expect(updateOrder).toEqual(['MH001', 'MH002']));
    expect(putAliasMock).toHaveBeenNthCalledWith(1, {
      scannedPartNumber: 'MH009X',
      canonicalPartNumber: 'MH001'
    });
    expect(putAliasMock).toHaveBeenNthCalledWith(2, {
      scannedPartNumber: 'MH009X',
      canonicalPartNumber: 'MH002'
    });
  });
});
