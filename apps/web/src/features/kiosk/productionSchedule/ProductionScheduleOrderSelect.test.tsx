import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { beforeEach, vi } from 'vitest';

import { ProductionScheduleOrderSelect } from './ProductionScheduleOrderSelect';
import { useProductionScheduleMutations } from './useProductionScheduleMutations';

const mocks = vi.hoisted(() => ({
  updateOrder: vi.fn(),
  updateSplitOrder: vi.fn()
}));

vi.mock('../../../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../api/client')>();
  return {
    ...original,
    updateKioskProductionScheduleOrder: mocks.updateOrder,
    updateKioskProductionScheduleSplitOrder: mocks.updateSplitOrder
  };
});

function Harness({ onChange }: { onChange: (value: string) => void }) {
  const [orderPending, setOrderPending] = useState(false);
  return (
    <>
      <ProductionScheduleOrderSelect
        rowId="row-1"
        resourceCd="500"
        currentOrder={1}
        disabled={false}
        orderPending={orderPending}
        getAvailableOrders={() => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
        onChange={(_rowId, _resourceCd, value) => {
          setOrderPending(true);
          onChange(value);
        }}
      />
      <button type="button" data-testid="save-failed" onClick={() => setOrderPending(false)}>
        save failed
      </button>
    </>
  );
}

test('updates the displayed order immediately while the save is pending', () => {
  const onChange = vi.fn();
  const view = render(<Harness onChange={onChange} />);

  fireEvent.click(view.getByRole('button', { name: '資源内の順位 1、タップで変更' }));
  fireEvent.click(view.getByRole('dialog').querySelector('button:nth-of-type(3)')!);

  expect(onChange).toHaveBeenCalledWith('2');
  expect(view.getByRole('button', { name: '資源内の順位 2、タップで変更' })).toBeInTheDocument();

  fireEvent.click(view.getByTestId('save-failed'));
  expect(view.getByRole('button', { name: '資源内の順位 1、タップで変更' })).toBeInTheDocument();
});

type ScheduleCache = {
  page: number;
  pageSize: number;
  total: number;
  rows: Array<{ id: string; occurredAt: string; rowData: { FSIGENCD: string }; processingOrder: number | null }>;
};

const scheduleKey = ['kiosk-production-schedule', { resourceCds: '500', targetDeviceScopeKey: 'device-a' }] as const;
const usageKey = ['kiosk-production-schedule-order-usage', '500', 'device-a'] as const;

function MutationHarness({ client }: { client: QueryClient }) {
  const schedule = useQuery<ScheduleCache>({
    queryKey: scheduleKey,
    queryFn: ({ queryKey }) => Promise.resolve(client.getQueryData<ScheduleCache>(queryKey)!),
    staleTime: Infinity
  });
  const { updateOrderAsync, orderPending } = useProductionScheduleMutations({
    isSearchStateWriting: false,
    noteMaxLength: 100,
    productionScheduleOrderCachePolicy: 'manualOrderOptimistic',
    productionScheduleTargetDeviceScopeKey: 'device-a'
  });
  const currentOrder = schedule.data?.rows[0]?.processingOrder ?? null;

  return (
    <ProductionScheduleOrderSelect
      rowId="row-1"
      resourceCd="500"
      currentOrder={currentOrder}
      disabled={false}
      orderPending={orderPending}
      getAvailableOrders={() => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
      onChange={(rowId, resourceCd, nextValue) => {
        return updateOrderAsync({
          rowId,
          resourceCd,
          orderNumber: nextValue.length > 0 ? Number(nextValue) : null
        });
      }}
    />
  );
}

function queryWrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.updateOrder.mockReset();
  mocks.updateSplitOrder.mockReset();
});

test('keeps immediate display through the real manual-order mutation and follows correction or rollback', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  client.setQueryData<ScheduleCache>(scheduleKey, {
    page: 1,
    pageSize: 100,
    total: 1,
    rows: [{ id: 'row-1', occurredAt: '', rowData: { FSIGENCD: '500' }, processingOrder: 1 }]
  });
  client.setQueryData(usageKey, { '500': [1] });
  const requests: Array<ReturnType<typeof deferred<{ success: true; orderNumber: number | null }>>> = [];
  mocks.updateOrder.mockImplementation(() => {
    const request = deferred<{ success: true; orderNumber: number | null }>();
    requests.push(request);
    return request.promise;
  });

  const view = render(<MutationHarness client={client} />, { wrapper: queryWrapper(client) });
  const choose = async (value: number) => {
    fireEvent.click(view.getByRole('button', { name: /資源内の順位/ }));
    const dialog = await view.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: String(value), exact: true }));
  };

  await choose(2);
  expect(view.getByRole('button', { name: '資源内の順位 2、タップで変更' })).toBeInTheDocument();
  await waitFor(() => {
    expect(mocks.updateOrder).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
  });

  await act(async () => {
    requests[0].resolve({ success: true, orderNumber: 7 });
  });
  await waitFor(() => {
    expect(view.getByRole('button', { name: '資源内の順位 7、タップで変更' })).toBeInTheDocument();
  });

  await choose(3);
  expect(view.getByRole('button', { name: '資源内の順位 3、タップで変更' })).toBeInTheDocument();
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => {
    requests[1].reject(new Error('save failed'));
  });
  await waitFor(() => {
    expect(view.getByRole('button', { name: '資源内の順位 7、タップで変更' })).toBeInTheDocument();
  });
});
