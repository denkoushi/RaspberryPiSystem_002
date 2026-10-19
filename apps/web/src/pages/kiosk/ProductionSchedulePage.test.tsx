import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductionSchedulePage } from './ProductionSchedulePage';

const testState = vi.hoisted(() => ({
  scheduleRows: [] as Array<Record<string, unknown>>,
  scheduleFetchCount: 0,
  usageFetchCount: 0,
  updateOrder: vi.fn(),
  updateSplitOrder: vi.fn()
}));

const idleMutation = vi.hoisted(
  () => () => ({
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => ({}))
  })
);

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    getKioskProductionSchedule: () => {
      if (testState.scheduleFetchCount++ > 0) return new Promise(() => {});
      return Promise.resolve({
        page: 1,
        pageSize: 400,
        total: testState.scheduleRows.length,
        rows: testState.scheduleRows
      });
    },
    getKioskProductionScheduleOrderUsage: () => {
      if (testState.usageFetchCount++ > 0) return new Promise(() => {});
      return Promise.resolve({
        R1: testState.scheduleRows
          .map((row) => row.processingOrder)
          .filter((value): value is number => typeof value === 'number')
      });
    },
    getKioskProductionScheduleResources: async () => ({
      resources: ['R1'],
      resourceItems: [],
      resourceNameMap: { R1: ['Resource 1'] }
    }),
    getKioskProductionScheduleProcessingTypeOptions: async () => [],
    getKioskProductionScheduleSearchState: async () => ({
      state: null,
      updatedAt: null,
      etag: null
    }),
    getKioskProductionScheduleHistoryProgress: async () => ({ progressBySeiban: {} }),
    getKioskProductionScheduleOrderSearchCandidates: async () => ({ orders: [], partNameOptions: [] }),
    updateKioskProductionScheduleOrder: (...args: unknown[]) => testState.updateOrder(...args),
    updateKioskProductionScheduleSplitOrder: (...args: unknown[]) => testState.updateSplitOrder(...args),
    setKioskProductionScheduleSearchState: async () => ({
      state: { history: [] },
      updatedAt: '2026-09-10T00:00:00Z',
      etag: 'etag'
    })
  };
});

vi.mock('../../api/hooks', async () => {
  const actual = await vi.importActual<typeof import('../../api/hooks')>('../../api/hooks');
  return {
    ...actual,
    useUpdateKioskProductionScheduleSearchState: () => ({
      isPending: false,
      mutateAsync: vi.fn(async () => ({ updatedAt: '2026-09-10T00:00:00Z', etag: 'etag' }))
    }),
    useSetKioskProductionScheduleRowCompletion: idleMutation,
    useUpdateKioskProductionScheduleProcessing: idleMutation,
    useUpdateKioskProductionScheduleNote: idleMutation,
    useUpdateKioskProductionScheduleDueDate: idleMutation,
    useUpdateKioskProductionScheduleSplitDueDate: idleMutation
  };
});

vi.mock('../../features/kiosk/productionSchedule/useProductionScheduleSearchConditions', () => ({
  useProductionScheduleSearchConditions: () => [
    {
      activeQueries: ['SEIBAN'],
      activeResourceCds: ['R1'],
      activeResourceAssignedOnlyCds: [],
      hasNoteOnlyFilter: false,
      hasDueDateOnlyFilter: false,
      showGrindingResources: true,
      showCuttingResources: false,
      selectedMachineName: '',
      selectedPartName: '',
      inputQuery: ''
    },
    vi.fn(),
    vi.fn()
  ]
}));

vi.mock('../../features/kiosk/productionSchedule/useProductionOrderSearch', () => ({
  useProductionOrderSearch: () => ({
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
    productNoInput: '',
    setProductNoInput: vi.fn(),
    appendDigit: vi.fn(),
    backspace: vi.fn(),
    clear: vi.fn(),
    selectedPartName: '',
    setSelectedPartName: vi.fn(),
    selectedOrderNumbers: [],
    toggleOrderNumber: vi.fn(),
    confirm: vi.fn(),
    canConfirm: false,
    canFetchCandidates: false,
    isLoading: false,
    partNameOptions: [],
    orders: []
  })
}));

vi.mock('../../features/kiosk/productionSchedule/useSharedSearchHistory', () => ({
  useSharedSearchHistory: () => ({ updateSharedSearchState: vi.fn(async () => undefined) })
}));

vi.mock('../../features/part-measurement/useKioskOpenPartMeasurementFromScheduleRow', () => ({
  useKioskOpenPartMeasurementFromScheduleRow: () => ({
    openFromScheduleRow: vi.fn(),
    busyRowId: null,
    error: null,
    clearError: vi.fn()
  })
}));

vi.mock('../../hooks/useLocalStorage', () => ({
  useLocalStorage: (_key: string, defaultValue: unknown) => [defaultValue, vi.fn()]
}));

vi.mock('../../hooks/useTimedHoverReveal', () => ({
  useTimedHoverReveal: () => ({
    isVisible: true,
    onHotZoneEnter: vi.fn(),
    onHeaderMouseEnter: vi.fn(),
    onHeaderMouseLeave: vi.fn()
  })
}));

vi.mock('../../config/productionBuildConfig', async () => {
  const actual = await vi.importActual<typeof import('../../config/productionBuildConfig')>(
    '../../config/productionBuildConfig'
  );
  return {
    ...actual,
    readProductionBuildConfig: () => ({
      ...actual.readProductionBuildConfig(),
      manualOrderDeviceScopeV2Enabled: false
    })
  };
});

vi.mock('../../lib/client-key/resolver', async () => {
  const actual = await vi.importActual<typeof import('../../lib/client-key/resolver')>(
    '../../lib/client-key/resolver'
  );
  return {
    ...actual,
    isMacEnvironment: () => false
  };
});

class TestResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe() {
    this.callback([{ contentRect: { width: 800 } } as ResizeObserverEntry], this);
  }

  disconnect() {}

  unobserve() {}
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ProductionSchedulePage />
      </QueryClientProvider>
    )
  };
}

function scheduleRow(id: string, productNo: string, processingOrder: number | null) {
  return {
    id,
    occurredAt: '',
    processingOrder,
    rowData: {
      ProductNo: productNo,
      FSEIBAN: `SEIBAN-${productNo}`,
      FHINCD: `PART-${productNo}`,
      FHINMEI: `Part ${productNo}`,
      FSIGENCD: 'R1',
      FKOJUN: '10',
      FKOJUNST: 'P'
    }
  };
}

function bodyRows() {
  return screen.getAllByRole('row').slice(1);
}

describe('ProductionSchedulePage processing-order selection', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    testState.scheduleRows = [scheduleRow('row-1', '101', null), scheduleRow('row-2', '202', 2)];
    testState.scheduleFetchCount = 0;
    testState.usageFetchCount = 0;
    testState.updateOrder.mockReset();
    testState.updateSplitOrder.mockReset();
  });

  it('並び替えを保存完了前に反映し、保存失敗時は元に戻す', async () => {
    let rejectRequest: ((error: Error) => void) | undefined;
    testState.updateOrder.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        })
    );

    renderPage();

    await waitFor(() => expect(within(bodyRows()[0]).getByText('202')).toBeInTheDocument());
    const rowOne = bodyRows().find((row) => row.textContent?.includes('101'));
    const orderSelect = rowOne?.querySelector('select.h-7.w-16');
    expect(orderSelect).not.toBeNull();

    fireEvent.change(orderSelect as HTMLSelectElement, { target: { value: '1' } });

    await waitFor(() => {
      expect(testState.updateOrder).toHaveBeenCalledWith('row-1', {
        resourceCd: 'R1',
        orderNumber: 1
      });
      expect(within(bodyRows()[0]).getByText('101')).toBeInTheDocument();
    });

    rejectRequest?.(new Error('save failed'));

    await waitFor(() => {
      expect(within(bodyRows()[0]).getByText('202')).toBeInTheDocument();
      expect((bodyRows()[0].querySelector('select.h-7.w-16') as HTMLSelectElement).value).toBe('2');
    });
  });

  it('split:* 行も保存完了前に並び替え、対象行IDを分割APIへ渡す', async () => {
    testState.scheduleRows = [
      scheduleRow('split:split-1', '101', null),
      scheduleRow('row-2', '202', 2)
    ];
    let resolveRequest: ((value: { success: true; orderNumber: number | null }) => void) | undefined;
    testState.updateSplitOrder.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );

    renderPage();

    await waitFor(() => expect(within(bodyRows()[0]).getByText('202')).toBeInTheDocument());
    const splitRow = bodyRows().find((row) => row.textContent?.includes('101'));
    const orderSelect = splitRow?.querySelector('select.h-7.w-16');
    expect(orderSelect).not.toBeNull();

    fireEvent.change(orderSelect as HTMLSelectElement, { target: { value: '1' } });

    await waitFor(() => {
      expect(testState.updateSplitOrder).toHaveBeenCalledWith('split-1', {
        resourceCd: 'R1',
        orderNumber: 1
      });
      expect(within(bodyRows()[0]).getByText('101')).toBeInTheDocument();
    });

    resolveRequest?.({ success: true, orderNumber: 1 });

    await waitFor(() => {
      expect(testState.scheduleFetchCount).toBeGreaterThanOrEqual(2);
      expect(within(bodyRows()[0]).getByText('101')).toBeInTheDocument();
      expect((bodyRows()[0].querySelector('select.h-7.w-16') as HTMLSelectElement).value).toBe('1');
    });
  });

  it('split:* 行は保存失敗時に元の表示順へ戻す', async () => {
    testState.scheduleRows = [
      scheduleRow('split:split-1', '101', null),
      scheduleRow('row-2', '202', 2)
    ];
    let rejectRequest: ((error: Error) => void) | undefined;
    testState.updateSplitOrder.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        })
    );

    renderPage();

    await waitFor(() => expect(within(bodyRows()[0]).getByText('202')).toBeInTheDocument());
    const splitRow = bodyRows().find((row) => row.textContent?.includes('101'));
    const orderSelect = splitRow?.querySelector('select.h-7.w-16');
    expect(orderSelect).not.toBeNull();

    fireEvent.change(orderSelect as HTMLSelectElement, { target: { value: '1' } });

    await waitFor(() => expect(within(bodyRows()[0]).getByText('101')).toBeInTheDocument());
    rejectRequest?.(new Error('save failed'));

    await waitFor(() => {
      expect(within(bodyRows()[0]).getByText('202')).toBeInTheDocument();
      expect((bodyRows()[0].querySelector('select.h-7.w-16') as HTMLSelectElement).value).toBe('2');
    });
  });
});
