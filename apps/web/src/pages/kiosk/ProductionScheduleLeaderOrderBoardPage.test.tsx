import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductionScheduleLeaderOrderBoardPage } from './ProductionScheduleLeaderOrderBoardPage';

import type { LeaderBoardGrid } from '../../features/kiosk/leaderOrderBoard/LeaderBoardGrid';
import type { ComponentProps, PropsWithChildren } from 'react';

const mocks = vi.hoisted(() => ({
  completeRow: vi.fn(), updateOrder: vi.fn(), orderError: null as Error | null,
  autoRank: vi.fn(), noop: () => {},
  activeQueries: [] as string[], sharedHistory: [] as string[]
}));
vi.mock('../../api/hooks', () => ({
  useKioskProductionScheduleResources: () => ({ data: { resources: ['R1'], resourceNameMap: {} } }),
  useKioskProductionScheduleOrderUsage: () => ({ data: {} }),
  useKioskProductionScheduleHistoryProgress: () => ({ data: { progressBySeiban: {} } })
}));
vi.mock('../../features/kiosk/leaderOrderBoard/useLeaderOrderBoardDeviceContext', () => ({
  useLeaderOrderBoardDeviceContext: () => ({
    siteKey: 'site', defaultSites: [], deviceCards: [], handleSiteChange: mocks.noop,
    resourceAssignmentsQuery: { isSuccess: false }
  })
}));
vi.mock('../../features/kiosk/leaderOrderBoard/usePersistedLeaderBoardDeviceScope', () => ({
  usePersistedLeaderBoardDeviceScope: () => ({ activeDeviceScopeKey: 'device', setActiveDeviceScopeKey: mocks.noop })
}));
vi.mock('../../features/kiosk/leaderOrderBoard/useLeaderBoardResourceSlotsWithServerSync', () => ({
  useLeaderBoardResourceSlotsWithServerSync: () => ({
    slotCount: 1, resourceCdBySlotIndex: ['R1'], activeResourceCds: ['R1'], setSlotCount: mocks.noop, assignSlotCd: mocks.noop
  })
}));
vi.mock('../../features/kiosk/productionSchedule/useProductionScheduleSearchConditions', () => ({
  useProductionScheduleSearchConditionsWithStorageKey: () => [{
    activeQueries: mocks.activeQueries, activeResourceAssignedOnlyCds: [],
    showGrindingResources: true, showCuttingResources: true
  }, mocks.noop]
}));
vi.mock('../../features/kiosk/productionSchedule/useProductionScheduleQueryParams', () => ({
  useProductionScheduleQueryParams: () => ({ selectedResourceCategory: 'grinding', queryParams: {}, hasResourceCategoryResourceSelection: true })
}));
vi.mock('../../features/kiosk/leaderOrderBoard/useLeaderboardBoardCacheMutationBridge', () => ({
  useLeaderboardBoardCacheMutationBridge: () => ({
    orderError: mocks.orderError, updateOrder: mocks.updateOrder, completeRow: mocks.completeRow
  })
}));
vi.mock('../../features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend', () => ({
  useCompositeLeaderboardPhasedScheduleWithAutoAppend: () => ({
    scheduleQuery: { data: { rows: [] }, isLoading: false, isError: false },
    applyDisplayMutation: mocks.noop, logClientPerfEvent: mocks.noop
  })
}));
vi.mock('../../features/kiosk/leaderOrderBoard/useLeaderBoardDueAssist', () => ({
  useLeaderBoardDueAssist: () => ({ selectedFseibanFilters: mocks.activeQueries, sharedHistory: mocks.sharedHistory })
}));
vi.mock('../../features/kiosk/leaderOrderBoard/useLeaderBoardSlotAutoRank', () => ({
  useLeaderBoardSlotAutoRank: () => ({ handleAutoRank: mocks.autoRank })
}));
vi.mock('../../features/kiosk/productionSchedule/DScheduleMinutesContext', () => ({
  DScheduleMinutesProvider: ({ children }: PropsWithChildren) => children
}));
vi.mock('../../hooks/useKioskLeftEdgeDrawerReveal', () => ({ useKioskLeftEdgeDrawerReveal: () => ({}) }));
vi.mock('../../features/kiosk/leaderOrderBoard/LeaderBoardGrid', () => ({
  LeaderBoardGrid: (props: ComponentProps<typeof LeaderBoardGrid>) => <>
    <button onClick={() => props.onCompleteRow('row', 'complete')}>complete</button>
    <button onClick={() => props.onCompleteRow('row', 'incomplete')}>incomplete</button>
    <button onClick={() => props.onOrderChange({ id: 'row', resourceCd: 'R1' } as Parameters<typeof props.onOrderChange>[0], '2')}>order</button>
    <button onClick={() => props.onAutoRank?.('R1')}>autoRank</button>
  </>
}));
vi.mock('../../features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack', () => ({ LeaderBoardLeftToolStack: () => null }));
vi.mock('../../features/kiosk/leaderOrderBoard/LeaderBoardSeibanListPanel', () => ({ LeaderBoardSeibanListPanel: () => null }));
vi.mock('../../features/kiosk/leaderOrderBoard/LeaderBoardResourceSlotPickerModal', () => ({ LeaderBoardResourceSlotPickerModal: () => null }));
vi.mock('../../features/kiosk/leaderOrderBoard/LeaderBoardInspectionWorkflowModal', () => ({ LeaderBoardInspectionWorkflowModal: () => null }));
vi.mock('../../components/kiosk/KioskDatePickerModal', () => ({ KioskDatePickerModal: () => null }));
vi.mock('../../components/kiosk/KioskNoteModal', () => ({ KioskNoteModal: () => null }));

let queryClient: QueryClient;
function page() {
  return <QueryClientProvider client={queryClient}><MemoryRouter><ProductionScheduleLeaderOrderBoardPage /></MemoryRouter></QueryClientProvider>;
}

describe('順位ボードの操作失敗通知', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.orderError = null;
    mocks.completeRow.mockReset().mockResolvedValue({});
    mocks.updateOrder.mockReset();
    mocks.autoRank.mockReset().mockResolvedValue(undefined);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  });
  afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(['complete', 'incomplete'])('%sの失敗は既存alertで通知しPromise拒否を処理する', async (intent) => {
    mocks.completeRow.mockRejectedValue(new Error('offline'));
    render(page());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: intent })); });
    expect(mocks.completeRow).toHaveBeenCalledWith('row', intent);
    expect(window.alert).toHaveBeenCalledExactlyOnceWith('保存に失敗しました。再度お試しください。');
  });

  it('順位変更のorderErrorを通知し、同じ失敗の再レンダーで重複通知しない', () => {
    const view = render(page());
    fireEvent.click(screen.getByRole('button', { name: 'order' }));
    expect(mocks.updateOrder).toHaveBeenCalledWith({ rowId: 'row', resourceCd: 'R1', nextValue: '2' });
    mocks.orderError = new Error('offline');
    view.rerender(page());
    expect(window.alert).toHaveBeenCalledExactlyOnceWith('保存に失敗しました。再度お試しください。');
    view.rerender(page());
    expect(window.alert).toHaveBeenCalledTimes(1);
    mocks.orderError = null;
    view.rerender(page());
    mocks.orderError = new Error('offline again');
    view.rerender(page());
    expect(window.alert).toHaveBeenCalledTimes(2);
  });

  it('成功時は失敗通知を出さない', async () => {
    render(page());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'complete' })); });
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('自動順位変更の拒否も処理し、orderErrorから一度だけ通知する', async () => {
    mocks.autoRank.mockRejectedValue(new Error('offline'));
    const view = render(page());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'autoRank' })); });
    mocks.orderError = new Error('offline');
    view.rerender(page());
    expect(window.alert).toHaveBeenCalledTimes(1);
  });
});
