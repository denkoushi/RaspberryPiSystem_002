import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useKioskGrindingPlanningBoardProgressive } from './production-schedule';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResponse } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ getBoard: vi.fn() }));

vi.mock('../../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/client')>();
  return { ...original, getKioskGrindingPlanningBoard: mocks.getBoard };
});

function item(id: string): GrindingPlanningBoardItem {
  return {
    itemId: id,
    kind: 'row',
    itemRevision: `revision-${id}`,
    version: 1,
    sourceRowId: `source-${id}`,
    fseiban: '26-1041',
    fhincd: `PART-${id}`,
    fhinmei: `部品${id}`,
    machineName: '自動組立機 AX-200',
    productNo: `PRODUCT-${id}`,
    processOrder: id,
    originalResourceCd: '305',
    effectiveResourceCd: null,
    originalDueDate: '2026-09-12',
    effectiveDueDate: null,
    originalRank: null,
    alternateRank: null,
    plannedQuantity: 5,
    requiredMinutes: 20,
    requiredMinutesKnown: true,
    isCompleted: false,
    progress: { completed: 0, total: 1, quantityKnown: false }
  };
}

function response(items: GrindingPlanningBoardItem[], nextCursor: string | null, overrides: Partial<GrindingPlanningBoardResponse> = {}): GrindingPlanningBoardResponse {
  return {
    siteKey: 'site-1',
    category: 'grinding',
    view: 'seiban',
    sourceRevision: 'revision-1',
    boardVersion: 1,
    registeredFseibans: ['26-1041'],
    seibanOrder: ['26-1041'],
    resources: ['305'],
    items,
    load: [],
    unknownRequiredMinutesCount: 0,
    seibanProgress: { '26-1041': { completed: 0, total: items.length } },
    snapshotId: 'snapshot-1',
    nextCursor,
    ...overrides
  };
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function QueryClientWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  QueryClientWrapper.displayName = 'QueryClientWrapper';
  return QueryClientWrapper;
}

describe('useKioskGrindingPlanningBoardProgressive', () => {
  beforeEach(() => mocks.getBoard.mockReset());

  it('初回ページを先にreadyにし、続き400件を順次追加する', async () => {
    const first = response([item('1')], '160');
    const second = response([item('2')], '320');
    const third = response([item('3')], null);
    let releaseContinue: (() => void) | undefined;
    const continueGate = new Promise<void>((resolve) => { releaseContinue = resolve; });
    mocks.getBoard
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(async () => { await continueGate; return second; })
      .mockResolvedValueOnce(third);
    const result = renderHook(
      () => useKioskGrindingPlanningBoardProgressive({ category: 'grinding', view: 'seiban', completionFilter: 'incomplete' }),
      { wrapper: wrapper() }
    );

    await waitFor(() => expect(result.result.current.scopeReady).toBe(true));
    expect(result.result.current.data?.items).toHaveLength(1);
    releaseContinue?.();
    await waitFor(() => expect(result.result.current.isComplete).toBe(true));
    expect(result.result.current.data?.items.map((entry) => entry.itemId)).toEqual(['1', '2', '3']);
    expect(mocks.getBoard).toHaveBeenCalledTimes(3);
  });

  it('追補の重複cursor/itemとscope不一致を表示データへ混ぜない', async () => {
    const first = response([item('1')], '160');
    mocks.getBoard.mockResolvedValueOnce(first).mockResolvedValueOnce(response([item('1')], null));
    const result = renderHook(
      () => useKioskGrindingPlanningBoardProgressive({ category: 'grinding', view: 'seiban' }),
      { wrapper: wrapper() }
    );
    await waitFor(() => expect(result.result.current.appendError).toBeTruthy());
    expect(result.result.current.data?.items).toHaveLength(1);

    mocks.getBoard.mockReset();
    mocks.getBoard.mockResolvedValueOnce(first).mockResolvedValueOnce(response([item('2')], null, { siteKey: 'other-site' }));
    const other = renderHook(
      () => useKioskGrindingPlanningBoardProgressive({ category: 'grinding', view: 'seiban' }),
      { wrapper: wrapper() }
    );
    await waitFor(() => expect(other.result.current.appendError).toBeTruthy());
    expect(other.result.current.data?.items).toHaveLength(1);
  });
});
