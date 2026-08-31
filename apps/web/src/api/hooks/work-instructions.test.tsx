import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  getWorkInstructionGroup,
  getWorkInstructionGroupsByPartNumber,
  type WorkInstructionGroup,
  type WorkInstructionGroupSummary
} from '../client';

import { useWorkInstructionGroup, useWorkInstructionGroups } from './work-instructions';

import type { PropsWithChildren } from 'react';

vi.mock('../client', () => ({
  getWorkInstructionGroup: vi.fn(),
  getWorkInstructionGroupsByPartNumber: vi.fn()
}));

const getGroups = vi.mocked(getWorkInstructionGroupsByPartNumber);
const getGroup = vi.mocked(getWorkInstructionGroup);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
}

const groups: WorkInstructionGroupSummary[] = [
  {
    partNumber: 'PART-1',
    shootingTarget: '研削',
    rowCount: 1,
    stepCount: 1,
    latestModified: '2026-08-31T00:00:00.000Z'
  }
];

const group: WorkInstructionGroup = {
  partNumber: 'PART-1',
  shootingTarget: '581',
  rows: [],
  steps: []
};

describe('work-instructions React Query hooks', () => {
  beforeEach(() => {
    getGroups.mockReset();
    getGroup.mockReset();
  });

  it('normalizes the part number for the groups query and key', async () => {
    getGroups.mockResolvedValue(groups);
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useWorkInstructionGroups(' ｐａｒｔ－１ '), {
      wrapper: createWrapper(queryClient)
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getGroups).toHaveBeenCalledWith('PART-1');
    expect(queryClient.getQueryCache().find({
      queryKey: ['work-instructions', 'groups', 'PART-1']
    })).toBeDefined();
    expect(result.current.data).toEqual(groups);
  });

  it('keeps groups disabled when the part number is blank', () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useWorkInstructionGroups(' \t '), {
      wrapper: createWrapper(queryClient)
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getGroups).not.toHaveBeenCalled();
  });

  it('keeps detail disabled when either part or target is blank', () => {
    const cases: Array<[string, string]> = [
      ['', '581'],
      ['PART-1', ''],
      ['  ', '581'],
      ['PART-1', '  ']
    ];

    for (const [partNumber, shootingTarget] of cases) {
      const queryClient = createQueryClient();
      const { result } = renderHook(
        () => useWorkInstructionGroup(partNumber, shootingTarget),
        { wrapper: createWrapper(queryClient) }
      );

      expect(result.current.fetchStatus).toBe('idle');
    }
    expect(getGroup).not.toHaveBeenCalled();
  });

  it('normalizes detail query values and preserves the group response', async () => {
    getGroup.mockResolvedValue(group);
    const queryClient = createQueryClient();

    const { result } = renderHook(
      () => useWorkInstructionGroup(' ｐａｒｔ－１ ', ' ５８１ '),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getGroup).toHaveBeenCalledWith('PART-1', '581');
    expect(queryClient.getQueryCache().find({
      queryKey: ['work-instructions', 'group', 'PART-1', '581']
    })).toBeDefined();
    expect(result.current.data).toEqual(group);
  });
});
