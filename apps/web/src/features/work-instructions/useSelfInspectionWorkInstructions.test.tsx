import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelfInspectionWorkInstructions } from './useSelfInspectionWorkInstructions';

const { useGroupsMock, useGroupMock, useManualsMock, getAliasMock, getCandidatesMock, putAliasMock } = vi.hoisted(() => ({
  useGroupsMock: vi.fn(),
  useManualsMock: vi.fn(),
  useGroupMock: vi.fn(),
  getAliasMock: vi.fn(),
  getCandidatesMock: vi.fn(),
  putAliasMock: vi.fn()
}));

vi.mock('../../api/hooks', () => ({
  useWorkInstructionGroups: useGroupsMock,
  useProcedureManualsByPart: useManualsMock,
  useWorkInstructionGroup: useGroupMock
}));

vi.mock('../../api/client', () => ({
  getWorkInstructionPartAlias: (...args: unknown[]) => getAliasMock(...args),
  getWorkInstructionPartCandidates: (...args: unknown[]) => getCandidatesMock(...args),
  putWorkInstructionPartAlias: (...args: unknown[]) => putAliasMock(...args)
}));

describe('useSelfInspectionWorkInstructions', () => {
  beforeEach(() => {
    useManualsMock.mockReset();
    useManualsMock.mockReturnValue({ data: { processes: [] }, isSuccess: true, isFetching: false, isError: false });
    useGroupsMock.mockReset();
    useGroupMock.mockReset();
    getAliasMock.mockReset();
    getCandidatesMock.mockReset();
    putAliasMock.mockReset();
    useGroupsMock.mockReturnValue({ data: undefined, isFetching: false });
    useGroupMock.mockReturnValue({ data: undefined });
  });

  it('unions targets in the existing order and counts each original once plus published manuals', () => {
    useGroupsMock.mockReturnValue({ data: [{ shootingTarget: '切削' }, { shootingTarget: '切削' }, { shootingTarget: '581' }], isSuccess: true, isFetching: false });
    useManualsMock.mockReturnValue({ data: { processes: [{ processId: 'grinding', processName: '研削', sequence: { documents: [{}, {}] } }, { processId: 'cutting', processName: '切削', sequence: { documents: [{}] } }] }, isSuccess: true, isFetching: false });
    const { result } = renderHook(() => useSelfInspectionWorkInstructions());
    act(() => { result.current.acceptPartScan('PART-1'); result.current.openTarget('研削'); });
    expect(result.current.targets).toEqual(['研削', '切削', '581']);
    expect(result.current.targetCounts).toEqual({ 研削: 2, 切削: 2, '581': 1 });
    expect(result.current.hasWorkInstruction).toBe(false);
    expect(result.current.selectedManualSequence?.documents).toHaveLength(2);
  });

  it('treats a manuals-only part as exact before alias or prefix lookup and waits for the manual response', async () => {
    useGroupsMock.mockReturnValue({ data: [], isSuccess: true, isFetching: false });
    useManualsMock.mockReturnValue({ data: undefined, isSuccess: false, isFetching: true });
    const { result, rerender } = renderHook(() => useSelfInspectionWorkInstructions());
    act(() => { result.current.acceptPartScan('part-1'); });
    expect(getAliasMock).not.toHaveBeenCalled();
    useManualsMock.mockReturnValue({ data: { processes: [{ processId: 'cutting', processName: '切削', sequence: { documents: [{}] } }] }, isSuccess: true, isFetching: false });
    rerender();
    await waitFor(() => expect(result.current.autoFallbackPending).toBe(false));
    expect(result.current.targets).toEqual(['切削']);
    expect(useManualsMock).toHaveBeenLastCalledWith('PART-1');
    expect(getAliasMock).not.toHaveBeenCalled();
    expect(getCandidatesMock).not.toHaveBeenCalled();
  });

  it('fetches canonical manuals when an alias resolves and keeps amber targets', async () => {
    useGroupsMock.mockReturnValue({ data: [], isSuccess: true, isFetching: false });
    useManualsMock.mockImplementation(part => ({ data: { processes: part === 'CANON' ? [{ processName: '研削', sequence: { documents: [{}] } }] : [] }, isSuccess: true, isFetching: false }));
    getAliasMock.mockResolvedValue({ scannedPartNumber: 'ALIAS', canonicalPartNumber: 'CANON' });
    const { result } = renderHook(() => useSelfInspectionWorkInstructions());
    act(() => { result.current.acceptPartScan('ALIAS'); });
    await waitFor(() => expect(result.current.targets).toEqual(['研削']));
    expect(result.current.partNumber).toBe('CANON');
    expect(result.current.similarMatch).toEqual({ scannedPartNumber: 'ALIAS', canonicalPartNumber: 'CANON' });
    expect(getCandidatesMock).not.toHaveBeenCalled();
  });

  it('keeps original chips and reports by-part failure without breaking resolution', async () => {
    useGroupsMock.mockReturnValue({ data: [{ shootingTarget: '研削' }], isSuccess: true, isFetching: false });
    useManualsMock.mockReturnValue({ data: undefined, isSuccess: false, isFetching: false, isError: true });
    const { result } = renderHook(() => useSelfInspectionWorkInstructions());
    act(() => { result.current.acceptPartScan('PART-1'); });
    await waitFor(() => expect(result.current.autoFallbackPending).toBe(false));
    expect(result.current.targets).toEqual(['研削']);
    expect(result.current.targetCounts).toEqual({ 研削: 1 });
    expect(result.current.manualErrorMessage).toBe('手順書を取得できませんでした。');
    expect(getAliasMock).not.toHaveBeenCalled();
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
