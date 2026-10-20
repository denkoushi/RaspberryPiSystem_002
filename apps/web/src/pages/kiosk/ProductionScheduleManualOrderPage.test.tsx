import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';

import { ProductionScheduleManualOrderPage } from './ProductionScheduleManualOrderPage';

import type {
  ProductionScheduleDueManagementManualOrderOverviewResultV2,
  ProductionScheduleListResponse,
  ProductionScheduleRow
} from '../../api/client';

const mocks = vi.hoisted(() => ({
  devices: vi.fn<typeof import('../../api/client').getKioskProductionScheduleManualOrderSiteDevices>(),
  overview: vi.fn<typeof import('../../api/client').getKioskProductionScheduleDueManagementManualOrderOverview>(),
  assignments: vi.fn<typeof import('../../api/client').getKioskProductionScheduleManualOrderResourceAssignments>(),
  schedule: vi.fn<typeof import('../../api/client').getKioskProductionSchedule>(),
  saveOrder: vi.fn<typeof import('../../api/client').updateKioskProductionScheduleOrder>(),
  saveAssignments: vi.fn<typeof import('../../api/client').putKioskProductionScheduleManualOrderResourceAssignments>(),
  saveSearch: vi.fn<typeof import('../../api/client').setKioskProductionScheduleSearchState>()
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    getResolvedClientKey: () => 'test-client',
    getKioskProductionScheduleManualOrderSiteDevices: mocks.devices,
    getKioskProductionScheduleDueManagementManualOrderOverview: mocks.overview,
    getKioskProductionScheduleManualOrderResourceAssignments: mocks.assignments,
    getKioskProductionSchedule: mocks.schedule,
    updateKioskProductionScheduleOrder: mocks.saveOrder,
    putKioskProductionScheduleManualOrderResourceAssignments: mocks.saveAssignments,
    setKioskProductionScheduleSearchState: mocks.saveSearch,
    getKioskProductionScheduleResources: async () => ({
      resources: ['305', '306', '307'],
      resourceItems: [],
      resourceNameMap: { '305': ['研削機A'], '306': ['研削機B'], '307': ['研削機C'] }
    } satisfies Awaited<ReturnType<typeof actual.getKioskProductionScheduleResources>>),
    getKioskProductionScheduleOrderUsage: async () => ({ '305': [1, 2] }),
    getKioskProductionScheduleProcessingTypeOptions: async () => [],
    getKioskProductionScheduleSearchState: async () => ({
      state: { history: [] }, updatedAt: '2026-10-20T00:00:00Z', etag: 'search-v1'
    }),
    getKioskProductionScheduleHistoryProgress: async () => ({ progressBySeiban: {} })
  };
});

vi.mock('../../api/hooks', async () => {
  const actual = await vi.importActual<typeof import('../../api/hooks')>('../../api/hooks');
  return { ...actual, useKioskSites: () => ({ data: undefined }) };
});

vi.mock('../../config/productionBuildConfig', async () => {
  const actual = await vi.importActual<typeof import('../../config/productionBuildConfig')>(
    '../../config/productionBuildConfig'
  );
  return {
    ...actual,
    readProductionBuildConfig: () => ({
      ...actual.readProductionBuildConfig(), manualOrderDeviceScopeV2Enabled: true
    })
  };
});

vi.mock('../../lib/client-key/resolver', async () => {
  const actual = await vi.importActual<typeof import('../../lib/client-key/resolver')>(
    '../../lib/client-key/resolver'
  );
  return { ...actual, isMacEnvironment: () => true };
});

const overview: ProductionScheduleDueManagementManualOrderOverviewResultV2 = {
  actorLocation: '第2工場',
  siteKey: '第2工場',
  deviceScopeKey: null,
  registeredDeviceScopeKeys: ['device-a', 'device-b'],
  devices: [
    {
      deviceScopeKey: 'device-a',
      label: '研削端末A',
      resources: [{
        resourceCd: '305', assignedCount: 2, maxOrderNumber: 2,
        avgGlobalRankGap: null, comparedCount: 0, missingGlobalRankCount: 0,
        lastUpdatedAt: null, lastUpdatedBy: null,
        rows: [{
          orderNumber: 1, fseiban: 'S-100', fhincd: 'P-100',
          processOrderLabel: '10', processLabel: '10', machineName: 'NVD-5000', partName: '軸'
        }]
      }]
    },
    { deviceScopeKey: 'device-b', label: '研削端末B', resources: [] }
  ]
};

function scheduleRow(id: string, processingOrder: number): ProductionScheduleRow {
  return {
    id, occurredAt: '2026-10-20T00:00:00Z', updatedAt: null, processingOrder,
    resolvedMachineName: 'NVD-5000',
    rowData: {
      FHINCD: `P-${id}`, ProductNo: `ORDER-${id}`, FHINMEI: `部品${id}`,
      FSIGENCD: '305', FSEIBAN: 'S-100', FKOJUN: '10', FKOJUNST: '未完了'
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// Advance React Query notifications without wall-clock sleeps or polling intervals.
async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
}

let client: QueryClient;
let rows: ProductionScheduleRow[];
let consoleError: ReturnType<typeof vi.spyOn<typeof console, 'error'>>;
const unexpectedRequests: string[] = [];
const originalAdapter = api.defaults.adapter;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

function renderPage() {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={['/kiosk/production-schedule/manual-order']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/kiosk/production-schedule/manual-order" element={<ProductionScheduleManualOrderPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function selectDevice() {
  await settle();
  fireEvent.click(screen.getByRole('button', { name: '研削端末A を編集' }));
  await settle();
  // Resource usage is fetched again once the schedule supplies its resource CDs.
  await settle();
}

function chooseOrder(label: string) {
  fireEvent.click(screen.getByRole('button', { name: '資源内の順位 1、タップで変更' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '順位を選択' })).getByRole('button', { name: label, exact: true }));
}

async function openAssignment() {
  await settle();
  fireEvent.click(screen.getByRole('button', { name: '研削端末A の資源割り当て' }));
  return within(screen.getByRole('dialog', { name: '資源の割り当て' }));
}

describe('ProductionScheduleManualOrderPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T12:00:00+09:00'));
    localStorage.clear();
    unexpectedRequests.length = 0;
    // Fail closed if a newly introduced API call escapes the explicit mocks.
    api.defaults.adapter = async (config) => {
      unexpectedRequests.push(config.url ?? 'unknown');
      throw new Error(`Unexpected API request: ${config.url}`);
    };
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      // React only warns for passive-effect loops. Throw so the broken version
      // fails promptly instead of hanging the runner indefinitely.
      if (args.some((arg) => String(arg).includes('Maximum update depth exceeded'))) {
        throw new Error('Maximum update depth exceeded');
      }
    });
    rows = [scheduleRow('100', 1), scheduleRow('200', 2)];
    mocks.devices.mockResolvedValue({ siteKey: '第2工場', deviceScopeKeys: ['device-a', 'device-b'] });
    mocks.overview.mockResolvedValue(overview);
    mocks.assignments.mockResolvedValue({
      siteKey: '第2工場',
      assignments: [
        { deviceScopeKey: 'device-a', resourceCds: ['305'] },
        { deviceScopeKey: 'device-b', resourceCds: ['307'] }
      ]
    });
    mocks.schedule.mockImplementation(async () => ({ page: 1, pageSize: 400, total: rows.length, rows }));
    mocks.saveOrder.mockImplementation(async (rowId, payload) => {
      rows = rows.map((row) => row.id === rowId ? { ...row, processingOrder: payload.orderNumber } : row);
      return { success: true, id: rowId, ...payload };
    });
    mocks.saveAssignments.mockImplementation(async (payload) => payload);
    mocks.saveSearch.mockResolvedValue({
      state: { history: ['S-100'] }, updatedAt: '2026-10-20T00:01:00Z', etag: 'search-v2'
    });
  });

  afterEach(() => {
    cleanup();
    client?.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    api.defaults.adapter = originalAdapter;
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
    localStorage.clear();
    expect(unexpectedRequests).toEqual([]);
  });

  it('renders the overview at the manual-order route and waits for an edit target', async () => {
    renderPage();
    expect(screen.getByText('上ペインを読み込み中…')).toBeInTheDocument();
    await settle();
    expect(screen.getByRole('heading', { name: '手動順番' })).toBeInTheDocument();
    expect(screen.getByText('生産スケジュール（既存UI）')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(within(screen.getAllByRole('article')[0]!).getByText('P-100')).toBeInTheDocument();
    expect(screen.getByText('資源未割り当て')).toBeInTheDocument();
    expect(screen.getByText('上ペインで端末を選択してください。')).toBeInTheDocument();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.devices).toHaveBeenCalledWith('第2工場');
    expect(mocks.overview).toHaveBeenCalledWith({ siteKey: '第2工場', rankingScope: 'globalShared' });
  });

  it('selects a device with 編集 and stays usable without Maximum update depth exceeded', async () => {
    renderPage();
    await selectDevice();
    expect(screen.getByText('編集中')).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getAllByRole('columnheader', { name: '資源順番' })).toHaveLength(2);
    expect(table.getByText('ORDER-100')).toBeInTheDocument();
    expect(table.getByText('ORDER-200')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '資源内の順位 1、タップで変更' })).toBeEnabled();
    expect(mocks.schedule).toHaveBeenCalledWith(expect.objectContaining({
      resourceCds: '305', resourceCategory: 'grinding', allowResourceOnly: true,
      targetDeviceScopeKey: 'device-a', page: 1, pageSize: 400
    }));
    fireEvent.click(screen.getByRole('button', { name: '研削端末B を編集' }));
    expect(within(screen.getAllByRole('article')[1]!).getByText('編集中')).toBeInTheDocument();
    expect(screen.getByText('検索してください。')).toBeInTheDocument();
    expect(consoleError.mock.calls.some((args) =>
      args.some((arg) => String(arg).includes('Maximum update depth exceeded'))
    )).toBe(false);
  });

  it('shows an overview API failure when there are no device cards', async () => {
    mocks.devices.mockRejectedValue(new Error('devices unavailable'));
    renderPage();
    await settle();
    expect(screen.getByText('上ペインの取得に失敗しました。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /を編集/ })).not.toBeInTheDocument();
  });

  it('shows schedule loading and then the empty result', async () => {
    const request = deferred<ProductionScheduleListResponse>();
    mocks.schedule.mockReturnValue(request.promise);
    renderPage();
    await selectDevice();
    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '検索', exact: true })).toBeDisabled();
    request.resolve({ page: 1, pageSize: 400, total: 0, rows: [] });
    await settle();
    expect(screen.getByText('該当するデータはありません。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '検索', exact: true })).toBeEnabled();
  });

  it('shows a schedule API error after selecting a device', async () => {
    mocks.schedule.mockRejectedValue(new Error('schedule unavailable'));
    renderPage();
    await selectDevice();
    expect(screen.getByText('取得に失敗しました。')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('trims search, writes shared history, applies note filtering and clears the search', async () => {
    renderPage();
    await selectDevice();
    const input = screen.getByPlaceholderText('製造order番号 / 製番で検索');
    fireEvent.change(input, { target: { value: '  S-100  ' } });
    fireEvent.click(screen.getByRole('button', { name: '検索', exact: true }));
    await settle();
    expect(input).toHaveValue('S-100');
    expect(mocks.schedule).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'S-100', resourceCds: '305' }));
    expect(mocks.saveSearch).toHaveBeenCalledWith({ state: { history: ['S-100'] }, ifMatch: 'search-v1' });
    fireEvent.click(screen.getByRole('button', { name: '備考あり' }));
    await settle();
    expect(mocks.schedule).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'S-100', hasNoteOnly: true }));
    fireEvent.click(screen.getByRole('button', { name: 'クリア', exact: true }));
    expect(input).toHaveValue('');
    expect(screen.getByText('検索してください。')).toBeInTheDocument();
  });

  it('saves a free resource order immediately and shows the saved value', async () => {
    renderPage();
    await selectDevice();
    fireEvent.click(screen.getByRole('button', { name: '資源内の順位 1、タップで変更' }));
    const picker = within(screen.getByRole('dialog', { name: '順位を選択' }));
    expect(picker.getByRole('button', { name: '1', exact: true })).toBeInTheDocument();
    expect(picker.queryByRole('button', { name: '2', exact: true })).not.toBeInTheDocument();
    expect(mocks.saveOrder).not.toHaveBeenCalled();
    fireEvent.click(picker.getByRole('button', { name: '3', exact: true }));
    await settle();
    expect(mocks.saveOrder).toHaveBeenCalledExactlyOnceWith('100', {
      resourceCd: '305', orderNumber: 3, targetDeviceScopeKey: 'device-a'
    });
    expect(screen.getByRole('button', { name: '資源内の順位 3、タップで変更' })).toHaveTextContent('3');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears an order by sending null', async () => {
    renderPage();
    await selectDevice();
    chooseOrder('-');
    await settle();
    expect(mocks.saveOrder).toHaveBeenCalledExactlyOnceWith('100', {
      resourceCd: '305', orderNumber: null, targetDeviceScopeKey: 'device-a'
    });
    expect(screen.getByRole('button', { name: '資源内の順位、タップで設定' })).toHaveTextContent('-');
  });

  it('rolls back a failed order save and displays the error on the page and device', async () => {
    mocks.saveOrder.mockRejectedValue(new Error('save unavailable'));
    renderPage();
    await selectDevice();
    chooseOrder('3');
    await settle();
    expect(mocks.saveOrder).toHaveBeenCalledExactlyOnceWith('100', {
      resourceCd: '305', orderNumber: 3, targetDeviceScopeKey: 'device-a'
    });
    expect(screen.getByText('保存に失敗しました。再度お試しください。')).toBeInTheDocument();
    expect(within(screen.getAllByRole('article')[0]!).getByText('保存に失敗しました')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '資源内の順位 1、タップで変更' })).toBeEnabled();
  });

  it('guards assigned resources, cancels a draft, then saves the chosen resource order', async () => {
    renderPage();
    let dialog = await openAssignment();
    expect(dialog.getByRole('button', { name: /307.*使用中/ })).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: '306（研削機B）' }));
    fireEvent.click(dialog.getByRole('button', { name: '306 を上へ' }));
    expect(dialog.getByRole('button', { name: '306 を上へ' })).toBeDisabled();
    expect(mocks.saveAssignments).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: '閉じる' }));
    expect(mocks.saveAssignments).not.toHaveBeenCalled();
    dialog = await openAssignment();
    expect(dialog.queryByRole('button', { name: '306 を上へ' })).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: '306（研削機B）' }));
    fireEvent.click(dialog.getByRole('button', { name: '306 を上へ' }));
    fireEvent.click(dialog.getByRole('button', { name: '保存' }));
    await settle();
    expect(mocks.saveAssignments).toHaveBeenCalledExactlyOnceWith({
      siteKey: '第2工場', deviceScopeKey: 'device-a', resourceCds: ['306', '305']
    });
    expect(screen.queryByRole('dialog', { name: '資源の割り当て' })).not.toBeInTheDocument();
  });

  it('keeps an assignment draft open and displays the server message on save failure', async () => {
    mocks.saveAssignments.mockRejectedValue({
      isAxiosError: true, response: { data: { message: '資源は別の端末に割り当て済みです' } }
    });
    renderPage();
    const dialog = await openAssignment();
    fireEvent.click(dialog.getByRole('button', { name: '306（研削機B）' }));
    fireEvent.click(dialog.getByRole('button', { name: '保存' }));
    await settle();
    expect(mocks.saveAssignments).toHaveBeenCalledExactlyOnceWith({
      siteKey: '第2工場', deviceScopeKey: 'device-a', resourceCds: ['305', '306']
    });
    expect(dialog.getByText('資源は別の端末に割り当て済みです')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: '306 を外す' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('resets device selection and search when changing the site', async () => {
    renderPage();
    await selectDevice();
    fireEvent.change(screen.getByRole('combobox', { name: '工場を選択' }), { target: { value: '第1工場' } });
    await settle();
    expect(mocks.devices).toHaveBeenLastCalledWith('第1工場');
    expect(mocks.overview).toHaveBeenLastCalledWith({ siteKey: '第1工場', rankingScope: 'globalShared' });
    expect(screen.queryByText('編集中')).not.toBeInTheDocument();
    expect(screen.getByText('上ペインで端末を選択してください。')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('製造order番号 / 製番で検索')).toHaveValue('');
  });
});
