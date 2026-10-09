import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as testingRender, screen, waitFor, within, cleanup } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { inventoryThumbnailUrl, resolveInventoryTag, type InventoryItem, type InventoryTag } from '../../api/client';
import { useInventoryCompartmentHistory, useInventoryImportSummaries, useInventoryItems, useInventoryMutations } from '../../api/hooks';
import { InventoryNfcRouter } from '../../features/kiosk/InventoryNfcRouter';
import { useNfcStream } from '../../hooks/useNfcStream';

import { KioskItemInventoryPage } from './KioskItemInventoryPage';

import type { NfcEvent } from '../../hooks/useNfcStream';


vi.mock('../../api/client', () => ({ resolveInventoryTag: vi.fn(), inventoryThumbnailUrl: vi.fn((value: string) => value) }));
vi.mock('../../api/hooks/item-inventory', () => ({ useInventoryTags: vi.fn() }));
vi.mock('../../api/hooks', () => ({
  useInventoryMutations: vi.fn(),
  useInventoryItems: vi.fn(() => ({ data: [], isLoading: false })),
  useInventoryImportSummaries: vi.fn(() => ({ data: [], isLoading: false })),
  useInventoryCompartmentHistory: vi.fn(() => ({ data: [], isLoading: false })),
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function render(ui: Parameters<typeof testingRender>[0]) {
  queryClient.clear();
  return testingRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> });
}

const itemTag = {
  id: 'item-tag-id',
  uid: 'item-uid',
  kind: 'ITEM',
  quantity: null,
  compartment: {
    id: 'compartment-id',
    stockQuantity: 10,
    area: '30007_KSJP-55',
    shelfNumber: 1,
    drawerNumber: 2,
    itemTagUid: 'item-uid',
    item: {
      id: 'inventory-item-id',
      itemCode: 'RI-2-TEST',
      name: '治具',
      model: null,
      usage: null,
      category: '治具',
      area: '30007_KSJP-55',
      note: null,
      photos: [{ id: 'inventory-photo-id', photoIndex: 1, photoUrl: '/photos/item.jpg', originalFilename: 'item.jpg' }],
      compartments: [],
    },
  },
} as InventoryTag;

const quantityTag = {
  id: 'quantity-tag-id',
  uid: 'quantity-uid',
  kind: 'QUANTITY',
  quantity: 2,
  compartment: null,
} as InventoryTag;

const otherItemTag = {
  ...itemTag,
  id: 'other-item-tag-id',
  uid: 'other-item-uid',
  compartment: {
    ...itemTag.compartment,
    id: 'other-compartment-id',
    stockQuantity: 20,
    itemTagUid: 'other-item-uid',
    item: { ...itemTag.compartment.item, id: 'other-inventory-item-id', itemCode: 'RI-2-OTHER' },
  },
} as InventoryTag;

describe('KioskItemInventoryPage', () => {
  it('keeps an item scan queued while lookup is delayed, then consumes the following quantity scan', async () => {
    const resolveItem = vi.fn<() => Promise<InventoryTag | null>>();
    let releaseItem: (tag: InventoryTag) => void = () => undefined;
    resolveItem.mockImplementationOnce(() => new Promise((resolve) => { releaseItem = resolve; }));
    vi.mocked(resolveInventoryTag).mockImplementation(async (uid) => {
      if (uid === itemTag.uid) return resolveItem();
      return quantityTag;
    });
    const mutateAsync = vi.fn().mockResolvedValue({
      transaction: {
        id: 'transaction-id',
        action: 'ISSUE',
        inventoryItemId: 'inventory-item-id',
        compartmentId: 'compartment-id',
        clientId: 'client-id',
        delta: -2,
        beforeQuantity: 10,
        afterQuantity: 8,
        createdAt: new Date().toISOString(),
        inventoryItem: { itemCode: 'RI-2-TEST', name: '治具' },
        compartment: null,
      },
    });
    const cancelMutateAsync = vi.fn().mockResolvedValue({
      transaction: {
        id: 'cancel-transaction-id',
        action: 'CANCEL',
        inventoryItemId: 'inventory-item-id',
        compartmentId: 'compartment-id',
        clientId: 'client-id',
        delta: 2,
        beforeQuantity: 8,
        afterQuantity: 10,
        createdAt: new Date().toISOString(),
        inventoryItem: { itemCode: 'RI-2-TEST', name: '治具' },
        compartment: null,
      },
    });
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync, isPending: false },
      cancel: { mutateAsync: cancelMutateAsync, isPending: false },
    } as never);

    let navigateToEvent: ((event: NfcEvent) => void) | null = null;
    function Driver() {
      const navigate = useNavigate();
      navigateToEvent = (event) => navigate('/kiosk/inventory', { replace: true, state: { inventoryNfcEvent: event } });
      return <KioskItemInventoryPage />;
    }

    render(<MemoryRouter initialEntries={['/kiosk/inventory']}><Driver /></MemoryRouter>);
    const timestamp = new Date().toISOString();
    await act(async () => { navigateToEvent?.({ uid: itemTag.uid, timestamp }); });
    await waitFor(() => expect(resolveInventoryTag).toHaveBeenCalledWith(itemTag.uid));
    await act(async () => { navigateToEvent?.({ uid: quantityTag.uid, timestamp: new Date(Date.now() + 1).toISOString() }); });
    expect(mutateAsync).not.toHaveBeenCalled();

    await act(async () => { releaseItem(itemTag); });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      itemTagUid: itemTag.uid,
      quantityTagUid: quantityTag.uid,
      restock: false,
    })));
    expect(screen.getByText(/払い出しました/)).toBeInTheDocument();
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('8個');
    expect(screen.getByAltText('item.jpg')).toBeInTheDocument();

    await act(async () => {
      navigateToEvent?.({ uid: otherItemTag.uid, timestamp: new Date(Date.now() + 2).toISOString(), inventoryTag: otherItemTag });
    });
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('20個');
    expect(screen.queryByRole('button', { name: /取消：/ })).not.toBeInTheDocument();
    expect(cancelMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('20個');
  });

  it('processes restock order, resets explicitly, and clears the flow after 30 seconds', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      transaction: {
        id: 'restock-transaction-id',
        action: 'RESTOCK',
        inventoryItemId: 'inventory-item-id',
        compartmentId: 'compartment-id',
        clientId: 'client-id',
        delta: 2,
        beforeQuantity: 10,
        afterQuantity: 12,
        createdAt: new Date().toISOString(),
        inventoryItem: { itemCode: 'RI-2-TEST', name: '治具' },
        compartment: null,
      },
    });
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync, isPending: false },
      cancel: { mutateAsync: vi.fn(), isPending: false },
    } as never);
    let navigateToEvent: ((event: NfcEvent) => void) | null = null;
    function Driver() {
      const navigate = useNavigate();
      navigateToEvent = (event) => navigate('/kiosk/inventory', { replace: true, state: { inventoryNfcEvent: event } });
      return <KioskItemInventoryPage />;
    }

    render(<MemoryRouter initialEntries={['/kiosk/inventory']}><Driver /></MemoryRouter>);
    const now = new Date().toISOString();
    await act(async () => {
      navigateToEvent?.({ uid: 'restock-uid', timestamp: now, inventoryTag: { id: 'restock-tag', uid: 'restock-uid', kind: 'RESTOCK', quantity: null, compartment: null } });
    });
    expect(screen.getByRole('button', { name: '補充' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => {
      navigateToEvent?.({ uid: itemTag.uid, timestamp: new Date(Date.now() + 1).toISOString(), inventoryTag: itemTag });
    });
    await act(async () => {
      navigateToEvent?.({ uid: quantityTag.uid, timestamp: new Date(Date.now() + 2).toISOString(), inventoryTag: quantityTag });
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ restock: true, restockTagUid: 'restock-uid' })));
    expect(screen.getByText(/補充しました/)).toBeInTheDocument();
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('12個');

    await act(async () => {
      navigateToEvent?.({ uid: 'restock-uid-2', timestamp: new Date(Date.now() + 3).toISOString(), inventoryTag: { id: 'restock-tag-2', uid: 'restock-uid-2', kind: 'RESTOCK', quantity: null, compartment: null } });
    });
    expect(screen.getByRole('button', { name: '補充' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { screen.getByRole('button', { name: '払い出し' }).click(); });
    expect(screen.getByRole('button', { name: '払い出し' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('アイテムタグ')).toBeInTheDocument();

    vi.useFakeTimers();
    try {
      await act(async () => {
        navigateToEvent?.({ uid: 'restock-uid-3', timestamp: new Date(Date.now() + 4).toISOString(), inventoryTag: { id: 'restock-tag-3', uid: 'restock-uid-3', kind: 'RESTOCK', quantity: null, compartment: null } });
      });
      expect(screen.getByRole('button', { name: '補充' })).toHaveAttribute('aria-pressed', 'true');
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      expect(screen.getByRole('button', { name: '払い出し' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('アイテムタグ')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

function historyEntry(overrides: Record<string, unknown>) {
  return {
    id: 'transaction-id',
    action: 'CORRECTION',
    inventoryItemId: 'inventory-item-id',
    compartmentId: 'compartment-id',
    clientId: 'client-id',
    delta: -1,
    beforeQuantity: 10,
    afterQuantity: 9,
    createdAt: new Date().toISOString(),
    inventoryItem: { itemCode: 'RI-2-TEST', name: '治具' },
    compartment: null,
    ...overrides,
  };
}

function renderWithNfc() {
  let navigateToEvent: ((event: NfcEvent) => void) | null = null;
  function Driver() {
    const navigate = useNavigate();
    navigateToEvent = (event) => navigate('/kiosk/inventory', { replace: true, state: { inventoryNfcEvent: event } });
    return <KioskItemInventoryPage />;
  }
  render(<MemoryRouter initialEntries={['/kiosk/inventory']}><Driver /></MemoryRouter>);
  let tick = 0;
  return async (tag: InventoryTag, inventoryTagNeedsRefresh = false, inventoryTagFromCache = false) => {
    tick += 1;
    await act(async () => { navigateToEvent?.({ uid: tag.uid, timestamp: new Date(Date.now() + tick).toISOString(), inventoryTag: tag, inventoryTagNeedsRefresh, inventoryTagFromCache }); });
  };
}

function pressDigits(digits: string) {
  const keypad = screen.getByRole('group', { name: '数えた数のテンキー' });
  for (const digit of digits) {
    fireEvent.click(Array.from(keypad.querySelectorAll('button')).find((button) => button.textContent === digit)!);
  }
}

describe('KioskItemInventoryPage stock correction and tag-less picking', () => {
  it('corrects stock without a password, then lets the worker undo it', async () => {
    const correction = vi.fn().mockResolvedValue({ transaction: historyEntry({ id: 'correction-id' }) });
    const cancel = vi.fn().mockResolvedValue({ transaction: historyEntry({ id: 'cancel-id', action: 'CANCEL', delta: 1, beforeQuantity: 9, afterQuantity: 10 }) });
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync: vi.fn(), isPending: false },
      cancel: { mutateAsync: cancel, isPending: false },
      correction: { mutateAsync: correction, isPending: false },
    } as never);
    const scan = renderWithNfc();
    await scan(itemTag);

    fireEvent.click(screen.getByRole('button', { name: '数が合わないときは直す' }));
    pressDigits('9');
    expect(screen.getByText('記録を 1個 減らします')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '9個に直す' })); });

    expect(vi.mocked(useInventoryMutations)).toHaveBeenCalledWith();
    expect(correction).toHaveBeenCalledWith({ compartmentId: 'compartment-id', desiredQuantity: 9, expectedBeforeQuantity: 10 });
    expect(screen.getByText('在庫を 1個 減らしました（10 → 9個）')).toBeInTheDocument();
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('9個');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /取消：治具/ })); });
    expect(cancel).toHaveBeenCalledWith('correction-id');
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('10個');
  });

  it('shows a refused correction next to the keypad and reloads the current stock', async () => {
    const correction = vi.fn().mockRejectedValue({ response: { data: { message: '在庫が変わりました。もう一度数えてください' } } });
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync: vi.fn(), isPending: false },
      cancel: { mutateAsync: vi.fn(), isPending: false },
      correction: { mutateAsync: correction, isPending: false },
    } as never);
    vi.mocked(resolveInventoryTag).mockResolvedValue({ ...itemTag, compartment: { ...itemTag.compartment!, stockQuantity: 8 } } as InventoryTag);
    const scan = renderWithNfc();
    await scan(itemTag);

    fireEvent.click(screen.getByRole('button', { name: '数が合わないときは直す' }));
    pressDigits('7');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '7個に直す' })); });

    expect(screen.getByRole('alert')).toHaveTextContent('在庫が変わりました');
    await waitFor(() => expect(screen.getByText('記録を 1個 減らします')).toBeInTheDocument());
    expect(screen.getByRole('region', { name: '在庫の数を直す' })).toBeInTheDocument();
  });

  it('keeps the correction panel open past the 30-second reset', async () => {
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync: vi.fn(), isPending: false },
      cancel: { mutateAsync: vi.fn(), isPending: false },
      correction: { mutateAsync: vi.fn(), isPending: false },
    } as never);
    const scan = renderWithNfc();
    await scan(itemTag);
    fireEvent.click(screen.getByRole('button', { name: '数が合わないときは直す' }));

    vi.useFakeTimers();
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(31000); });
      expect(screen.getByRole('region', { name: '在庫の数を直す' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('picks a drawer by touch and takes items out with a quantity tag', async () => {
    const transaction = vi.fn().mockResolvedValue({ transaction: historyEntry({ action: 'ISSUE', delta: -2, afterQuantity: 8 }) });
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync: transaction, isPending: false },
      cancel: { mutateAsync: vi.fn(), isPending: false },
      correction: { mutateAsync: vi.fn(), isPending: false },
    } as never);
    const item = { ...itemTag.compartment!.item, compartments: [itemTag.compartment!] } as InventoryItem;
    vi.mocked(useInventoryItems).mockReturnValue({ data: [item], isLoading: false } as never);
    const scan = renderWithNfc();

    fireEvent.click(within(screen.getByLabelText('登録済みアイテム')).getByRole('button', { name: /治具/ }));
    expect(screen.getByText('数を押す か 数量タグ')).toBeInTheDocument();
    await scan(quantityTag);

    await waitFor(() => expect(transaction).toHaveBeenCalledWith(expect.objectContaining({ itemTagUid: 'item-uid', expectedCompartmentId: itemTag.compartment!.id, quantityTagUid: 'quantity-uid', restock: false })));
  });

  it('takes items out of a picked drawer with no item tag using the freshly resolved quantity', async () => {
    const transaction = vi.fn();
    const touch = vi.fn().mockResolvedValue({ transaction: historyEntry({ id: 'untagged-quantity-issue', action: 'ISSUE', delta: -3, afterQuantity: 7 }) });
    vi.mocked(resolveInventoryTag).mockReset().mockResolvedValue({ ...quantityTag, quantity: 3 });
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync: transaction, isPending: false },
      touchTransaction: { mutateAsync: touch, isPending: false },
      cancel: { mutateAsync: vi.fn(), isPending: false },
      correction: { mutateAsync: vi.fn(), isPending: false },
    } as never);
    const untagged = { ...itemTag.compartment!, itemTagUid: null };
    vi.mocked(useInventoryItems).mockReturnValue({ data: [{ ...untagged.item, compartments: [untagged] }], isLoading: false } as never);
    const scan = renderWithNfc();

    fireEvent.click(within(screen.getByLabelText('登録済みアイテム')).getByRole('button', { name: /治具/ }));
    await scan(quantityTag);

    expect(resolveInventoryTag).toHaveBeenCalledExactlyOnceWith(quantityTag.uid);
    expect(touch).toHaveBeenCalledExactlyOnceWith({ compartmentId: untagged.id, quantity: 3, restock: false, expectedBeforeQuantity: 10, idempotencyKey: expect.any(String) });
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('7個');
    expect(screen.getByRole('status')).toHaveTextContent('払い出しました');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('KioskItemInventoryPage units', () => {
  it('shows stock and results in the item unit', async () => {
    const correction = vi.fn().mockResolvedValue({ transaction: historyEntry({ id: 'correction-case', beforeQuantity: 10, afterQuantity: 8, delta: -2 }) });
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync: vi.fn(), isPending: false },
      cancel: { mutateAsync: vi.fn(), isPending: false },
      correction: { mutateAsync: correction, isPending: false },
    } as never);
    const caseTag = { ...itemTag, compartment: { ...itemTag.compartment!, item: { ...itemTag.compartment!.item, unit: 'ケース' } } } as InventoryTag;
    const scan = renderWithNfc();
    await scan(caseTag);

    expect(screen.getByLabelText('現在庫')).toHaveTextContent('10ケース');
    fireEvent.click(screen.getByRole('button', { name: '数が合わないときは直す' }));
    pressDigits('8');
    expect(screen.getByText('記録を 2ケース 減らします')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '8ケースに直す' })); });
    expect(screen.getByText('在庫を 2ケース 減らしました（10 → 8ケース）')).toBeInTheDocument();
  });
});

describe('KioskItemInventoryPage item list and history', () => {
  it('lists registered drawers on the waiting screen and opens one by touch', async () => {
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync: vi.fn(), isPending: false },
      cancel: { mutateAsync: vi.fn(), isPending: false },
      correction: { mutateAsync: vi.fn(), isPending: false },
    } as never);
    const item = { ...itemTag.compartment!.item, compartments: [itemTag.compartment!] } as InventoryItem;
    vi.mocked(useInventoryItems).mockReturnValue({ data: [item], isLoading: false } as never);
    renderWithNfc();

    expect(screen.getByText('アイテムタグ')).toBeInTheDocument();
    expect(screen.queryByText(/30秒/)).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText('登録済みアイテム')).getByRole('button', { name: /治具/ }));

    expect(screen.getByText('数を押す か 数量タグ')).toBeInTheDocument();
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('10個');
  });

  it('shows the latest five movements and opens the rest in place', async () => {
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync: vi.fn(), isPending: false },
      cancel: { mutateAsync: vi.fn(), isPending: false },
      correction: { mutateAsync: vi.fn(), isPending: false },
    } as never);
    const rows = Array.from({ length: 7 }, (_, index) => historyEntry({ id: `h-${index}`, action: 'ISSUE', delta: -1, beforeQuantity: 20 - index, afterQuantity: 19 - index }));
    vi.mocked(useInventoryCompartmentHistory).mockReturnValue({ data: rows, isLoading: false } as never);
    const scan = renderWithNfc();
    await scan(itemTag);

    const history = screen.getByRole('region', { name: '最近の動き' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(within(history).getByRole('button', { name: 'あと2件' }));
    expect(within(history).getAllByRole('listitem')).toHaveLength(7);
  });

  it('goes back to the list from an item by the back button', async () => {
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync: vi.fn(), isPending: false },
      cancel: { mutateAsync: vi.fn(), isPending: false },
      correction: { mutateAsync: vi.fn(), isPending: false },
    } as never);
    const item = { ...itemTag.compartment!.item, compartments: [itemTag.compartment!] } as InventoryItem;
    vi.mocked(useInventoryItems).mockReturnValue({ data: [item], isLoading: false } as never);
    renderWithNfc();

    expect(screen.queryByRole('button', { name: '一覧へ' })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText('登録済みアイテム')).getByRole('button', { name: /治具/ }));
    fireEvent.click(screen.getByRole('button', { name: '一覧へ' }));

    expect(screen.getByLabelText('登録済みアイテム')).toBeInTheDocument();
    expect(screen.queryByLabelText('現在庫')).not.toBeInTheDocument();
  });

  it('opens setup for an unregistered candidate card', () => {
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync: vi.fn(), isPending: false },
      cancel: { mutateAsync: vi.fn(), isPending: false },
      correction: { mutateAsync: vi.fn(), isPending: false },
    } as never);
    vi.mocked(useInventoryImportSummaries).mockReturnValue({
      data: [{ id: 'p5', sourceItemId: 5, area: '30042S_FJV50/80', category: '段取工具', createdAt: '2026-09-30T05:45:05Z', photoUrl: null, photoCount: 1 }],
      isLoading: false,
    } as never);
    function SettingsProbe() {
      const location = useLocation();
      return <p>setup {(location.state as { importId?: string } | null)?.importId}</p>;
    }
    render(
      <MemoryRouter initialEntries={['/kiosk/inventory']}>
        <Routes>
          <Route path="/kiosk/inventory" element={<KioskItemInventoryPage />} />
          <Route path="/kiosk/inventory/settings" element={<SettingsProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '未登録 候補 #5 を登録する' }));
    expect(screen.getByText('setup p5')).toBeInTheDocument();
    vi.mocked(useInventoryImportSummaries).mockReturnValue({ data: [], isLoading: false } as never);
  });
});

describe('KioskItemInventoryPage UX safeguards', () => {
  it('distinguishes loading, failed loading with retry, and an empty list', () => {
    const refetch = vi.fn();
    vi.mocked(useInventoryItems).mockReturnValue({ isLoading: true, data: undefined } as never);
    const view = render(<MemoryRouter><KioskItemInventoryPage /></MemoryRouter>);
    expect(screen.getByText('読み込み中…')).toBeInTheDocument();
    expect(screen.queryByText('登録済みのアイテムはまだありません')).not.toBeInTheDocument();
    vi.mocked(useInventoryItems).mockReturnValue({ isLoading: false, isError: true, refetch } as never);
    view.rerender(<MemoryRouter><KioskItemInventoryPage /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('一覧を取得できませんでした');
    fireEvent.click(screen.getByRole('button', { name: 'もう一度' }));
    expect(refetch).toHaveBeenCalledOnce();
    vi.mocked(useInventoryItems).mockReturnValue({ data: [], isLoading: false, isError: false } as never);
    view.rerender(<MemoryRouter><KioskItemInventoryPage /></MemoryRouter>);
    expect(screen.getByText('登録済みのアイテムはまだありません')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /取消：|選択をリセット|補充をやめる/ })).not.toBeInTheDocument();
  });

  it('keeps the item selected after issuing so the next quantity tag works, and clears undo on reset', async () => {
    const transaction = vi.fn()
      .mockResolvedValueOnce({ transaction: historyEntry({ action: 'ISSUE', delta: -2, afterQuantity: 8 }) })
      .mockResolvedValueOnce({ transaction: historyEntry({ id: 'history-next', action: 'ISSUE', delta: -2, beforeQuantity: 8, afterQuantity: 6 }) });
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: transaction }, cancel: { mutateAsync: vi.fn() } } as never);
    vi.useFakeTimers();
    try {
      const scan = renderWithNfc();
      await scan(itemTag);
      expect(screen.getByText('数を押す か 数量タグ')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '一覧へ' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '選択をリセット' })).not.toBeInTheDocument();
      await scan(quantityTag);
      expect(screen.getByRole('button', { name: '取消：治具 -2個' })).toBeInTheDocument();
      expect(screen.getByLabelText('現在庫')).toHaveTextContent('-2');
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
      expect(screen.getByText('数を押す か 数量タグ')).toBeInTheDocument();
      expect(screen.queryByText('アイテムタグ')).not.toBeInTheDocument();
      expect(screen.getByLabelText('現在庫')).toHaveTextContent('8個');
      await scan(quantityTag);
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(transaction).toHaveBeenLastCalledWith(expect.objectContaining({ itemTagUid: itemTag.uid, quantityTagUid: quantityTag.uid, restock: false }));
      expect(screen.getByLabelText('現在庫')).toHaveTextContent('-2');
      fireEvent.click(screen.getByRole('button', { name: '一覧へ' }));
      expect(screen.queryByRole('button', { name: /取消：/ })).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('extends inactivity on clicks and keys and drops undo after the automatic return', async () => {
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: vi.fn().mockResolvedValue({ transaction: historyEntry({ action: 'ISSUE' }) }) } } as never);
    vi.useFakeTimers();
    try {
      const scan = renderWithNfc();
      await scan(itemTag);
      await scan(quantityTag);
      await act(async () => { await vi.advanceTimersByTimeAsync(25000); });
      fireEvent.click(screen.getByAltText('item.jpg'));
      await act(async () => { await vi.advanceTimersByTimeAsync(25000); });
      expect(screen.getByLabelText('現在庫')).toBeInTheDocument();
      fireEvent.keyDown(screen.getByAltText('item.jpg'), { key: 'ArrowRight' });
      await act(async () => { await vi.advanceTimersByTimeAsync(29000); });
      expect(screen.getByRole('button', { name: /取消：/ })).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.queryByLabelText('現在庫')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /取消：/ })).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('reloads a tagless drawer after a correction conflict and uses its latest stock on retry', async () => {
    const correction = vi.fn().mockRejectedValueOnce({ response: { status: 409, data: { message: '在庫が変わりました' } } }).mockResolvedValueOnce({ transaction: historyEntry({ afterQuantity: 7 }) });
    vi.mocked(useInventoryMutations).mockReturnValue({ correction: { mutateAsync: correction }, transaction: { mutateAsync: vi.fn() } } as never);
    const untagged = { ...itemTag.compartment!, itemTagUid: null };
    const refetch = vi.fn().mockResolvedValue({ data: [{ ...untagged.item, compartments: [{ ...untagged, stockQuantity: 8 }] }] });
    vi.mocked(useInventoryItems).mockReturnValue({ data: [{ ...untagged.item, compartments: [untagged] }], isLoading: false, refetch } as never);
    const lookup = vi.mocked(resolveInventoryTag).mock.calls.length;
    renderWithNfc();
    fireEvent.click(within(screen.getByLabelText('登録済みアイテム')).getByRole('button', { name: /治具/ }));
    fireEvent.click(screen.getByRole('button', { name: '数が合わないときは直す' }));
    pressDigits('7');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '7個に直す' })); });
    expect(refetch).toHaveBeenCalledOnce();
    expect(vi.mocked(resolveInventoryTag).mock.calls).toHaveLength(lookup);
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('8個');
    expect(screen.getByText('記録を 1個 減らします')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '7個に直す' })); });
    expect(correction).toHaveBeenLastCalledWith({ compartmentId: untagged.id, desiredQuantity: 7, expectedBeforeQuantity: 8 });
  });
});


it('does not redraw the item grid when a prompt changes or its four-second timer expires', async () => {
  const item = { ...itemTag.compartment!.item, compartments: [itemTag.compartment!] } as InventoryItem;
  vi.mocked(useInventoryItems).mockReturnValue({ data: [item], isLoading: false } as never);
  vi.mocked(useInventoryImportSummaries).mockReturnValue({ data: [], isLoading: false } as never);
  vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: vi.fn() } } as never);
  vi.useFakeTimers();
  try {
    const scan = renderWithNfc();
    const renders = vi.mocked(inventoryThumbnailUrl).mock.calls.length;
    await scan(quantityTag);
    expect(screen.getByRole('status')).toHaveTextContent('先にアイテム');
    expect(vi.mocked(inventoryThumbnailUrl).mock.calls).toHaveLength(renders);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText('アイテムタグ')).toBeInTheDocument();
    expect(vi.mocked(inventoryThumbnailUrl).mock.calls).toHaveLength(renders);
    expect(screen.getByLabelText('登録済みアイテム').querySelector('img')).toHaveAttribute('loading', 'lazy');
    expect(screen.getByLabelText('登録済みアイテム').querySelector('img')).toHaveAttribute('decoding', 'async');
  } finally { vi.useRealTimers(); }
});

describe('daily touch movements and inline location filters', () => {
  it('records a tagless drawer immediately, prevents double taps, and supports repeat and undo', async () => {
    let release: (value: unknown) => void = () => undefined;
    const touch = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })).mockResolvedValue({ transaction: historyEntry({ action: 'ISSUE', delta: -1, afterQuantity: 8 }) });
    const cancel = vi.fn().mockResolvedValue({ transaction: historyEntry({ action: 'CANCEL', delta: 1, afterQuantity: 9 }) });
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: vi.fn() }, touchTransaction: { mutateAsync: touch }, cancel: { mutateAsync: cancel } } as never);
    const drawer = { ...itemTag.compartment!, itemTagUid: null };
    vi.mocked(useInventoryItems).mockReturnValue({ data: [{ ...drawer.item, compartments: [drawer] }] } as never);
    renderWithNfc();
    fireEvent.click(within(screen.getByLabelText('登録済みアイテム')).getByRole('button', { name: /治具/ }));
    fireEvent.click(screen.getByRole('button', { name: '1個を払い出す' }));
    const first = touch.mock.calls[0][0];
    expect(first).toEqual({ compartmentId: drawer.id, quantity: 1, restock: false, expectedBeforeQuantity: 10, idempotencyKey: expect.any(String) });
    expect(first.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    for (const quantity of [1, 2, 5, 10, 20]) expect(screen.getByRole('button', { name: `${quantity}個を払い出す` })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ほかの数' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '1個を払い出す' }));
    expect(touch).toHaveBeenCalledOnce();
    await act(async () => { release({ transaction: historyEntry({ action: 'ISSUE', delta: -1, afterQuantity: 9 }) }); });
    expect(screen.getByRole('status')).toHaveTextContent('払い出しました（1個）');
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('9個-1');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '1個を払い出す' })); });
    expect(touch.mock.calls[1][0].expectedBeforeQuantity).toBe(9);
    expect(touch.mock.calls[1][0].idempotencyKey).not.toBe(first.idempotencyKey);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '取消：治具 -1個' })); });
    expect(cancel).toHaveBeenCalledWith('transaction-id');
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('9個');
  });

  it('shares restock mode with tags and submits another quantity through the existing keypad', async () => {
    const touch = vi.fn().mockResolvedValue({ transaction: historyEntry({ action: 'RESTOCK', delta: 37, afterQuantity: 47 }) });
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: vi.fn() }, touchTransaction: { mutateAsync: touch } } as never);
    const scan = renderWithNfc();
    await scan({ id: 'restock', uid: 'restock', kind: 'RESTOCK', quantity: null, compartment: null });
    await scan(itemTag);
    expect(screen.getByRole('button', { name: '5個を補充' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ほかの数' }));
    expect(screen.getByRole('button', { name: '決定' })).toBeDisabled();
    const keypad = screen.getByRole('group', { name: '操作する数のテンキー' });
    fireEvent.click(within(keypad).getByRole('button', { name: '3' }));
    fireEvent.click(within(keypad).getByRole('button', { name: '7' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '決定' })); });
    expect(touch).toHaveBeenCalledWith(expect.objectContaining({ quantity: 37, restock: true, expectedBeforeQuantity: 10 }));
    expect(screen.queryByRole('region', { name: 'ほかの数を入れる' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('47個+37');
    expect(screen.getByRole('button', { name: '払い出し' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses touch restock with the authoritative quantity when restock was chosen in the header', async () => {
    const transaction = vi.fn();
    const touch = vi.fn().mockResolvedValue({ transaction: historyEntry({ id: 'header-restock-id', action: 'RESTOCK', delta: 7, afterQuantity: 17 }) });
    vi.mocked(resolveInventoryTag).mockReset().mockResolvedValue({ ...quantityTag, quantity: 7 });
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: transaction }, touchTransaction: { mutateAsync: touch } } as never);
    const scan = renderWithNfc();
    await scan(itemTag);
    fireEvent.click(screen.getByRole('button', { name: '補充' }));
    await scan(quantityTag);
    expect(resolveInventoryTag).toHaveBeenCalledExactlyOnceWith(quantityTag.uid);
    expect(touch).toHaveBeenCalledExactlyOnceWith({ compartmentId: itemTag.compartment!.id, quantity: 7, restock: true, expectedBeforeQuantity: 10, idempotencyKey: expect.any(String) });
    expect(transaction).not.toHaveBeenCalled();
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('17個+7');
  });

  it('reports insufficient stock beside the quantity buttons and reloads conflicts before retry', async () => {
    const touch = vi.fn().mockRejectedValueOnce({ response: { status: 409, data: { errorCode: 'INVENTORY_INSUFFICIENT_STOCK' } } }).mockRejectedValueOnce({ response: { status: 409, data: { errorCode: 'INVENTORY_CONFLICT' } } }).mockResolvedValueOnce({ transaction: historyEntry({ action: 'ISSUE', delta: -1, afterQuantity: 3 }) });
    const refetch = vi.fn().mockResolvedValue({ data: [{ ...itemTag.compartment!.item, compartments: [{ ...itemTag.compartment!, stockQuantity: 4 }] }] });
    vi.mocked(useInventoryItems).mockReturnValue({ data: [], refetch } as never);
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: vi.fn() }, touchTransaction: { mutateAsync: touch } } as never);
    const scan = renderWithNfc();
    await scan(itemTag);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '20個を払い出す' })); });
    const errorRow = screen.getByRole('alert').parentElement;
    expect(screen.getByRole('alert')).toHaveTextContent('在庫が足りません');
    expect(errorRow).toHaveClass('h-11');
    expect(refetch).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '1個を払い出す' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('数が変わりました');
    expect(screen.getByRole('alert').parentElement).toBe(errorRow);
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('4個');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '1個を払い出す' })); });
    expect(touch).toHaveBeenLastCalledWith(expect.objectContaining({ expectedBeforeQuantity: 4 }));
  });

  it('toggles area and shelf in place, resets shelf on area change, and keeps candidates available', () => {
    const base = itemTag.compartment!;
    const drawers = [base, { ...base, id: 'shelf2', shelfNumber: 2 }, { ...base, id: 'other-area', area: '別エリア' }];
    vi.mocked(useInventoryItems).mockReturnValue({ data: [{ ...base.item, compartments: drawers }] } as never);
    vi.mocked(useInventoryImportSummaries).mockReturnValue({ data: [{ id: 'pending', sourceItemId: 42, area: '別エリア', photoUrl: null }] } as never);
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: vi.fn() } } as never);
    renderWithNfc();
    const area = within(screen.getByRole('group', { name: 'エリアで絞る' })).getByRole('button', { name: /30007_KSJP-55/ });
    const cards = () => within(screen.getByLabelText('登録済みアイテム')).getAllByRole('button');
    expect(cards()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: '置き場所から選ぶ' })).not.toBeInTheDocument();
    fireEvent.click(area);
    expect(cards()).toHaveLength(3);
    const shelf = within(screen.getByRole('group', { name: '棚で絞る' })).getByRole('button', { name: '棚2' });
    fireEvent.click(shelf);
    expect(cards()).toHaveLength(2);
    expect(cards()[0]).toHaveAccessibleName('未登録 候補 #42 を登録する');
    fireEvent.click(shelf);
    expect(cards()).toHaveLength(3);
    fireEvent.click(shelf);
    fireEvent.click(within(screen.getByRole('group', { name: 'エリアで絞る' })).getByRole('button', { name: /別エリア/ }));
    expect(cards()).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '棚2' })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'エリアで絞る' })).getByRole('button', { name: /別エリア/ }));
    expect(cards()).toHaveLength(4);
    expect(screen.queryByRole('group', { name: '棚で絞る' })).not.toBeInTheDocument();
  });
});


it('shows a cached tag identity before resolve completes and waits for authoritative stock', async () => {
  let release: (tag: InventoryTag) => void = () => undefined;
  vi.mocked(resolveInventoryTag).mockReset().mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: vi.fn() } } as never);
  const scan = renderWithNfc();
  await scan({ ...itemTag, compartment: { ...itemTag.compartment!, stockQuantity: NaN } }, true);
  expect(screen.getByRole('heading', { name: '治具' })).toBeInTheDocument();
  expect(screen.getByLabelText('現在庫')).toHaveTextContent('—個');
  expect(screen.getByRole('button', { name: '1個を払い出す' })).toBeDisabled();
  expect(resolveInventoryTag).toHaveBeenCalledExactlyOnceWith(itemTag.uid);
  await act(async () => { release({ ...itemTag, compartment: { ...itemTag.compartment!, stockQuantity: 6 } }); });
  expect(screen.getByLabelText('現在庫')).toHaveTextContent('6個');
  expect(screen.getByRole('button', { name: '1個を払い出す' })).toBeEnabled();
});


describe('cached ITEM tag verification', () => {
  const reassignedTag = { ...otherItemTag, compartment: { ...otherItemTag.compartment!, item: { ...otherItemTag.compartment!.item, name: '別の治具' } } } as InventoryTag;
  function pendingVerification() {
    let release: (tag: InventoryTag | null) => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    vi.mocked(resolveInventoryTag).mockReset().mockImplementationOnce(() => new Promise((resolve, rejectPromise) => {
      release = resolve;
      reject = rejectPromise;
    }));
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: vi.fn() } } as never);
    return { release: (tag: InventoryTag | null) => release(tag), reject: () => reject(new Error('offline')) };
  }

  it('displays immediately with enabled quantity buttons, then replaces a reassigned compartment', async () => {
    const lookup = pendingVerification();
    const scan = renderWithNfc();
    await scan(itemTag, false, true);
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('10個');
    expect(screen.getByRole('button', { name: '1個を払い出す' })).toBeEnabled();
    expect(resolveInventoryTag).toHaveBeenCalledExactlyOnceWith(itemTag.uid);
    await act(async () => { lookup.release({ ...reassignedTag, uid: itemTag.uid }); });
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('20個');
    expect(screen.getByRole('heading', { name: '別の治具' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '治具' })).not.toBeInTheDocument();
  });

  it('updates stock for the same compartment without replacing the photo or closing the panel', async () => {
    const lookup = pendingVerification();
    const scan = renderWithNfc();
    await scan(itemTag, false, true);
    const photo = screen.getByAltText('item.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'ほかの数' }));
    await act(async () => { lookup.release({ ...itemTag, compartment: { ...itemTag.compartment!, stockQuantity: 6 } }); });
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('6個');
    expect(screen.getByAltText('item.jpg')).toBe(photo);
    expect(screen.getByRole('group', { name: '操作する数のテンキー' })).toBeInTheDocument();
  });

  it('clears selection and shows a short error when the tag was removed', async () => {
    const lookup = pendingVerification();
    const scan = renderWithNfc();
    await scan(itemTag, false, true);
    await act(async () => { lookup.release(null); });
    expect(screen.queryByLabelText('現在庫')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1個を払い出す' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('タグの登録が変わりました');
  });

  it('discards a pending result after another tag is scanned', async () => {
    const lookup = pendingVerification();
    const scan = renderWithNfc();
    await scan(itemTag, false, true);
    await scan(reassignedTag);
    await act(async () => { lookup.release(null); });
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('20個');
    expect(screen.getByRole('heading', { name: '別の治具' })).toBeInTheDocument();
    expect(screen.queryByText('タグの登録が変わりました')).not.toBeInTheDocument();
  });

  it('keeps the displayed item and quantity buttons when verification fails', async () => {
    const lookup = pendingVerification();
    const scan = renderWithNfc();
    await scan(itemTag, false, true);
    await act(async () => { lookup.reject(); });
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('10個');
    expect(screen.getByRole('button', { name: '1個を払い出す' })).toBeEnabled();
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
  });

  it('discards a pending result after returning to the list', async () => {
    const lookup = pendingVerification();
    const scan = renderWithNfc();
    await scan(itemTag, false, true);
    fireEvent.click(screen.getByRole('button', { name: '一覧へ' }));
    await act(async () => { lookup.release(reassignedTag); });
    expect(screen.queryByLabelText('現在庫')).not.toBeInTheDocument();
  });

  it('discards a waiting quantity operation when verification reassigns the compartment', async () => {
    const lookup = pendingVerification();
    const transaction = vi.fn();
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: transaction } } as never);
    const scan = renderWithNfc();
    queryClient.setQueryData(['inventory-tags'], [itemTag]);
    await scan(itemTag, false, true);
    await scan(quantityTag);
    expect(transaction).not.toHaveBeenCalled();
    await act(async () => { lookup.release(reassignedTag); });
    expect(transaction).not.toHaveBeenCalled();
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('20個');
    expect(screen.getByRole('heading', { name: '別の治具' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /取消：/ })).not.toBeInTheDocument();
    expect(queryClient.getQueryState(['inventory-tags'])?.isInvalidated).toBe(true);
  });

  it('waits before sending a number button operation and uses the verified stock', async () => {
    const lookup = pendingVerification();
    const transaction = vi.fn().mockResolvedValue({ transaction: historyEntry({ id: 'verified-touch-id', action: 'ISSUE', delta: -1, beforeQuantity: 6, afterQuantity: 5 }) });
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: vi.fn() }, touchTransaction: { mutateAsync: transaction } } as never);
    const scan = renderWithNfc();
    await scan(itemTag, false, true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '1個を払い出す' })); });
    expect(transaction).not.toHaveBeenCalled();
    await act(async () => { lookup.release({ ...itemTag, compartment: { ...itemTag.compartment!, stockQuantity: 6 } }); });
    expect(transaction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ compartmentId: itemTag.compartment!.id, quantity: 1, expectedBeforeQuantity: 6 }));
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('5個');
    expect(screen.getByRole('status')).toHaveTextContent('払い出しました');
  });

  it.each([quantityTag, { id: 'restock-tag', uid: itemTag.uid, kind: 'RESTOCK', quantity: null, compartment: null } as InventoryTag])('clears the cached item when verification returns $kind', async (latest) => {
    const lookup = pendingVerification();
    const scan = renderWithNfc();
    await scan(itemTag, false, true);
    await act(async () => { lookup.release(latest); });
    expect(screen.queryByLabelText('現在庫')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '補充' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('タグの登録が変わりました');
  });
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

let scenarioNumber = 0;
function operationScenario() {
  scenarioNumber += 1;
  const suffix = `operation-${scenarioNumber}`;
  const tag = {
    ...itemTag, id: `${suffix}-tag`, uid: `${suffix}-uid`,
    compartment: {
      ...itemTag.compartment!, id: `${suffix}-compartment`, itemTagUid: `${suffix}-uid`,
      item: { ...itemTag.compartment!.item, id: `${suffix}-item`, name: `${suffix}治具` },
    },
  } as InventoryTag;
  const quantity = { ...quantityTag, id: `${suffix}-quantity-tag`, uid: `${suffix}-quantity-uid` };
  const transaction = (overrides: Record<string, unknown> = {}) => historyEntry({
    id: `${suffix}-transaction`, compartmentId: tag.compartment!.id, inventoryItemId: tag.compartment!.item.id,
    inventoryItem: { itemCode: tag.compartment!.item.itemCode, name: tag.compartment!.item.name },
    action: 'ISSUE', delta: -2, afterQuantity: 8, ...overrides,
  });
  vi.mocked(useInventoryItems).mockReturnValue({ data: [], refetch: vi.fn().mockResolvedValue({ data: [] }) } as never);
  return { tag, quantity, transaction, suffix };
}

describe('serialized inventory operations', () => {
  it.each(['nfc', 'touch'] as const)('keeps the screen and cancel button usable after a %s response without inventoryItem', async (source) => {
    const { tag, quantity, transaction } = operationScenario();
    const { inventoryItem, ...response } = transaction();
    const movement = vi.fn().mockResolvedValue({ transaction: response });
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: movement }, touchTransaction: { mutateAsync: movement } } as never);
    const scan = renderWithNfc();
    await scan(tag);
    if (source === 'nfc') await scan(quantity);
    else await act(async () => { fireEvent.click(screen.getByRole('button', { name: '1個を払い出す' })); });

    expect(movement).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('払い出しました（2個）');
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('8個');
    expect(screen.getByRole('button', { name: new RegExp(`取消：${inventoryItem.name}`) })).toBeEnabled();
  });

  it.each([false, true])('uses only the movement compartment name when inventoryItem is missing (compartment known: %s)', async (known) => {
    const selected = operationScenario();
    const moved = operationScenario();
    const { inventoryItem, ...response } = moved.transaction();
    const movement = vi.fn().mockResolvedValue({ transaction: response });
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: movement } } as never);
    if (known) vi.mocked(useInventoryItems).mockReturnValue({ data: [{ ...moved.tag.compartment!.item, compartments: [moved.tag.compartment!] }] } as never);
    const scan = renderWithNfc();
    await scan(selected.tag);
    await scan(selected.quantity);

    expect(screen.getByRole('status')).toHaveTextContent('払い出しました（2個）');
    const cancel = screen.getByRole('button', { name: known ? new RegExp(`取消：${inventoryItem.name}`) : /^取消\s*-2個$/ });
    expect(cancel).toBeEnabled();
    expect(cancel).not.toHaveTextContent(selected.tag.compartment!.item.name);
  });

  it.each([false, true])('sends a waiting quantity exactly once after same-compartment verification (unknown stock: %s)', async (unknownStock) => {
    const { tag, quantity, transaction } = operationScenario();
    const verification = deferred<InventoryTag | null>();
    const movement = deferred<{ transaction: ReturnType<typeof transaction> }>();
    vi.mocked(resolveInventoryTag).mockReset().mockReturnValueOnce(verification.promise);
    const write = vi.fn().mockReturnValueOnce(movement.promise);
    const touch = vi.fn().mockResolvedValue({ transaction: transaction({ id: `${tag.id}-touch`, delta: -1, beforeQuantity: 5, afterQuantity: 4 }) });
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: write }, touchTransaction: { mutateAsync: touch } } as never);
    const scan = renderWithNfc();
    await scan(unknownStock ? { ...tag, compartment: { ...tag.compartment!, stockQuantity: NaN } } : tag, unknownStock, true);
    await scan(quantity);
    expect(write).not.toHaveBeenCalled();
    await act(async () => { verification.resolve({ ...tag, compartment: { ...tag.compartment!, stockQuantity: 7 } }); });
    expect(write).toHaveBeenCalledExactlyOnceWith({ itemTagUid: tag.uid, expectedCompartmentId: tag.compartment!.id, quantityTagUid: quantity.uid, restock: false, restockTagUid: undefined, idempotencyKey: expect.any(String) });
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('7個');
    await act(async () => { movement.resolve({ transaction: transaction({ beforeQuantity: 7, afterQuantity: 5 }) }); });
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('5個');
    expect(screen.getByRole('button', { name: '1個を払い出す' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '一覧へ' })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '1個を払い出す' })); });
    expect(touch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ compartmentId: tag.compartment!.id, expectedBeforeQuantity: 5 }));
    expect(write).toHaveBeenCalledOnce();
  });

  it('continues the waiting operation after an offline verification while preserving the immediate display', async () => {
    const { tag, quantity, transaction } = operationScenario();
    const verification = deferred<InventoryTag | null>();
    vi.mocked(resolveInventoryTag).mockReset().mockReturnValueOnce(verification.promise);
    const write = vi.fn().mockResolvedValue({ transaction: transaction() });
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: write } } as never);
    const scan = renderWithNfc();
    await scan(tag, false, true);
    await scan(quantity);
    expect(write).not.toHaveBeenCalled();
    await act(async () => { verification.reject(new Error('offline')); });
    expect(write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemTagUid: tag.uid, quantityTagUid: quantity.uid }));
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('8個');
  });

  it.each([null, quantityTag])('drops a waiting operation and invalidates the table when ITEM verification returns %s', async (latest) => {
    const { tag, quantity } = operationScenario();
    const verification = deferred<InventoryTag | null>();
    vi.mocked(resolveInventoryTag).mockReset().mockReturnValueOnce(verification.promise);
    const write = vi.fn();
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: write } } as never);
    const scan = renderWithNfc();
    queryClient.setQueryData(['inventory-tags'], [tag]);
    await scan(tag, false, true);
    await scan(quantity);
    await act(async () => { verification.resolve(latest); });
    expect(write).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('現在庫')).not.toBeInTheDocument();
    expect(queryClient.getQueryState(['inventory-tags'])?.isInvalidated).toBe(true);
  });

  it.each([new Error('Network Error'), { code: 'ECONNABORTED' }, { response: { status: 503 } }])('refreshes uncertain touch outcomes and drops all scans received during the request: %s', async (failure) => {
    const { tag, quantity, transaction } = operationScenario();
    const request = deferred<{ transaction: ReturnType<typeof transaction> }>();
    const refresh = deferred<{ data: InventoryItem[] }>();
    const refetch = vi.fn().mockReturnValueOnce(refresh.promise);
    vi.mocked(useInventoryItems).mockReturnValue({ data: [], refetch } as never);
    const touch = vi.fn().mockReturnValueOnce(request.promise);
    const write = vi.fn();
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: write }, touchTransaction: { mutateAsync: touch } } as never);
    const scan = renderWithNfc();
    await scan(tag);
    // Two clicks in one React update must still acquire only one synchronous lock.
    await act(async () => {
      const button = screen.getByRole('button', { name: '1個を払い出す' });
      button.click();
      button.click();
    });
    await scan(quantity);
    await act(async () => { request.reject(failure); });
    expect(refetch).toHaveBeenCalledOnce();
    expect(touch).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
    await scan(tag);
    await scan(quantity);
    await act(async () => { refresh.resolve({ data: [{ ...tag.compartment!.item, compartments: [{ ...tag.compartment!, stockQuantity: 9 }] }] as InventoryItem[] }); });
    expect(write).not.toHaveBeenCalled();
    expect(touch).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('9個');
    expect(screen.getByRole('alert')).toHaveTextContent('通信できませんでした。在庫数を確かめてください');
    expect(screen.getByRole('alert').parentElement).toHaveClass('h-11');
    expect(screen.getByRole('button', { name: '1個を払い出す' })).toBeEnabled();
    // Only a fresh scan after the failed operation may start another transaction.
    write.mockResolvedValueOnce({ transaction: transaction({ id: `${tag.id}-fresh-transaction`, beforeQuantity: 9, afterQuantity: 7 }) });
    await scan(quantity);
    expect(write).toHaveBeenCalledOnce();
  });

  it.each([true, false])('switches to the response compartment and undoes the response transaction (cached: %s)', async (cached) => {
    const first = operationScenario();
    const second = operationScenario();
    const items = [{ ...second.tag.compartment!.item, unit: '本', compartments: [second.tag.compartment!] }] as InventoryItem[];
    const refetch = vi.fn().mockResolvedValue({ data: items });
    vi.mocked(useInventoryItems).mockReturnValue({ data: [], refetch } as never);
    const response = second.transaction({ delta: -3, afterQuantity: 17 });
    const touch = vi.fn().mockResolvedValue({ transaction: response });
    const cancel = vi.fn().mockResolvedValue({ transaction: second.transaction({ id: `${second.suffix}-cancel`, action: 'CANCEL', delta: 3, afterQuantity: 20 }) });
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: vi.fn() }, touchTransaction: { mutateAsync: touch }, cancel: { mutateAsync: cancel } } as never);
    const scan = renderWithNfc();
    if (cached) queryClient.setQueryData(['inventory-items'], items);
    await scan(first.tag);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '1個を払い出す' })); });
    expect(touch).toHaveBeenCalledWith(expect.objectContaining({ compartmentId: first.tag.compartment!.id }));
    expect(screen.getByRole('heading', { name: second.tag.compartment!.item.name })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: first.tag.compartment!.item.name })).not.toBeInTheDocument();
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('17本-3');
    expect(screen.getByRole('status')).toHaveTextContent('払い出しました（3本）');
    expect(refetch).toHaveBeenCalledTimes(cached ? 0 : 1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /取消：/ })); });
    expect(cancel).toHaveBeenCalledExactlyOnceWith(response.id);
  });

  it.each(['cancel', 'correction'] as const)('processes scans after the pending %s and keeps the newer transaction for undo', async (operation) => {
    const first = operationScenario();
    const second = operationScenario();
    const pending = deferred<{ transaction: ReturnType<typeof first.transaction> }>();
    const nextMovement = deferred<{ transaction: ReturnType<typeof second.transaction> }>();
    const write = vi.fn().mockReturnValueOnce(nextMovement.promise);
    const cancel = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValueOnce({ transaction: second.transaction({ id: `${second.suffix}-cancel`, action: 'CANCEL', afterQuantity: 10 }) });
    const correction = vi.fn().mockReturnValueOnce(pending.promise);
    const touch = vi.fn().mockResolvedValueOnce({ transaction: first.transaction({ delta: -1, afterQuantity: 9 }) });
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: write }, touchTransaction: { mutateAsync: touch }, cancel: { mutateAsync: cancel }, correction: { mutateAsync: correction } } as never);
    const scan = renderWithNfc();
    await scan(first.tag);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '1個を払い出す' })); });
    if (operation === 'cancel') {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /取消：/ })); });
      expect(cancel).toHaveBeenCalledExactlyOnceWith(first.transaction().id);
    } else {
      fireEvent.click(screen.getByRole('button', { name: '数が合わないときは直す' }));
      pressDigits('8');
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '8個に直す' })); });
      expect(correction).toHaveBeenCalledExactlyOnceWith({ compartmentId: first.tag.compartment!.id, desiredQuantity: 8, expectedBeforeQuantity: 9 });
    }
    await scan(second.tag);
    await scan(second.quantity);
    expect(write).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText('現在庫').closest('div')!).getByRole('heading', { name: first.tag.compartment!.item.name })).toBeInTheDocument();
    await act(async () => { pending.resolve({ transaction: first.transaction({ id: `${first.suffix}-${operation}`, action: operation === 'cancel' ? 'CANCEL' : 'CORRECTION', afterQuantity: 10 }) }); });
    expect(write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemTagUid: second.tag.uid, quantityTagUid: second.quantity.uid }));
    expect(screen.getByRole('heading', { name: second.tag.compartment!.item.name })).toBeInTheDocument();
    await act(async () => { nextMovement.resolve({ transaction: second.transaction() }); });
    const undo = screen.getByRole('button', { name: new RegExp(`取消：${second.tag.compartment!.item.name}`) });
    expect(undo).toBeEnabled();
    await act(async () => { fireEvent.click(undo); });
    expect(cancel).toHaveBeenLastCalledWith(second.transaction().id);
    expect(screen.queryByRole('button', { name: /取消：/ })).not.toBeInTheDocument();
  });

  it('invalidates the tag table on a rejected tag transaction and discards queued scans', async () => {
    const first = operationScenario();
    const second = operationScenario();
    const request = deferred<never>();
    const write = vi.fn().mockReturnValueOnce(request.promise);
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: write } } as never);
    const scan = renderWithNfc();
    queryClient.setQueryData(['inventory-tags'], [first.tag, second.tag]);
    await scan(first.tag);
    await scan(first.quantity);
    await scan(second.tag);
    await scan(second.quantity);
    await act(async () => { request.reject({ response: { status: 404, data: { message: 'タグが見つかりません' } } }); });
    expect(write).toHaveBeenCalledOnce();
    expect(queryClient.getQueryState(['inventory-tags'])?.isInvalidated).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('タグが見つかりません');
    expect(within(screen.getByLabelText('現在庫').closest('div')!).getByRole('heading', { name: first.tag.compartment!.item.name })).toBeInTheDocument();
  });

  it('drops a scan read before a failed operation even after the page was left and reopened', async () => {
    const first = operationScenario();
    const second = operationScenario();
    const request = deferred<never>();
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: vi.fn().mockReturnValueOnce(request.promise) } } as never);
    const scan = renderWithNfc();
    await scan(first.tag);
    await scan(first.quantity);
    const readBeforeFailure = performance.now();
    await act(async () => { request.reject({ response: { status: 404, data: { message: 'タグが見つかりません' } } }); });
    cleanup();

    let deliver: ((event: NfcEvent) => void) | null = null;
    function Driver() {
      const navigate = useNavigate();
      deliver = (event) => navigate('/kiosk/inventory', { replace: true, state: { inventoryNfcEvent: event } });
      return <KioskItemInventoryPage />;
    }
    render(<MemoryRouter initialEntries={['/kiosk/inventory']}><Driver /></MemoryRouter>);
    const event = (receivedAt: number, tick: number): NfcEvent => ({ uid: second.tag.uid, timestamp: new Date(Date.now() + tick).toISOString(), inventoryTag: second.tag, receivedAt });
    await act(async () => { deliver?.(event(readBeforeFailure, 1)); });
    expect(screen.queryByLabelText('現在庫')).not.toBeInTheDocument();
    await act(async () => { deliver?.(event(performance.now() + 1, 2)); });
    expect(screen.getByLabelText('現在庫')).toBeInTheDocument();
  });
});

describe('inventory scan safety boundaries', () => {
  it.each(['scan', 'list'])('pins a quantity transaction to the displayed compartment and clears a conflicting %s selection', async (selection) => {
    const { tag, quantity } = operationScenario();
    const write = vi.fn().mockRejectedValue({ response: { status: 409, data: { errorCode: 'INVENTORY_CONFLICT', message: 'タグの登録が変わりました' } } });
    const touch = vi.fn();
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: write }, touchTransaction: { mutateAsync: touch } } as never);
    const items = [{ ...tag.compartment!.item, compartments: [tag.compartment!] }] as InventoryItem[];
    vi.mocked(useInventoryItems).mockReturnValue({ data: items } as never);
    const scan = renderWithNfc();
    queryClient.setQueryData(['inventory-tags'], [tag, quantity]);
    queryClient.setQueryData(['inventory-items'], items);
    if (selection === 'scan') await scan(tag);
    else fireEvent.click(within(screen.getByLabelText('登録済みアイテム')).getByRole('button', { name: new RegExp(tag.compartment!.item.name) }));
    await scan(quantity);
    expect(write).toHaveBeenCalledExactlyOnceWith({
      itemTagUid: tag.uid, expectedCompartmentId: tag.compartment!.id, quantityTagUid: quantity.uid,
      restock: false, restockTagUid: undefined, idempotencyKey: expect.any(String),
    });
    expect(screen.queryByLabelText('現在庫')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('タグの登録が変わりました');
    expect(queryClient.getQueryState(['inventory-tags'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['inventory-items'])?.isInvalidated).toBe(true);
    expect(touch).not.toHaveBeenCalled();
  });

  it.each([false, true])('clears the previous selection for an ITEM without a compartment (cached: %s)', async (cached) => {
    const { tag, quantity, suffix } = operationScenario();
    const write = vi.fn();
    const touch = vi.fn();
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: write }, touchTransaction: { mutateAsync: touch } } as never);
    const scan = renderWithNfc();
    queryClient.setQueryData(['inventory-tags'], [tag]);
    await scan(tag);
    await scan({ ...tag, id: `${suffix}-unassigned`, uid: `${suffix}-unassigned-uid`, compartment: null }, false, cached);
    expect(screen.queryByLabelText('現在庫')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('アイテムNFCタグに区画が割り当てられていません');
    expect(queryClient.getQueryState(['inventory-tags'])?.isInvalidated).toBe(cached);
    await scan(quantity);
    expect(write).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
  });

  it.each([false, true])('clears unknown stock after offline verification (quantity already waiting: %s)', async (waiting) => {
    const { tag, quantity } = operationScenario();
    const verification = deferred<InventoryTag | null>();
    vi.mocked(resolveInventoryTag).mockReset().mockReturnValueOnce(verification.promise);
    const write = vi.fn();
    const touch = vi.fn();
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: write }, touchTransaction: { mutateAsync: touch } } as never);
    const scan = renderWithNfc();
    await scan({ ...tag, compartment: { ...tag.compartment!, stockQuantity: NaN } }, true, true);
    expect(screen.getByLabelText('現在庫')).toHaveTextContent('—個');
    if (waiting) await scan(quantity);
    await act(async () => { verification.reject(new Error('Network Error')); });
    expect(screen.queryByLabelText('現在庫')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('通信できませんでした');
    expect(screen.getByRole('button', { name: '補充' })).toBeEnabled();
    expect(write).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
  });

  it.each(['number', 'quantity'])('does not send a waiting %s operation after leaving during ITEM verification', async (operation) => {
    const { tag, quantity } = operationScenario();
    const verification = deferred<InventoryTag | null>();
    vi.mocked(resolveInventoryTag).mockReset().mockReturnValueOnce(verification.promise);
    const write = vi.fn();
    const touch = vi.fn();
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: write }, touchTransaction: { mutateAsync: touch } } as never);
    let send: (tag: InventoryTag) => void = () => undefined;
    function Driver() {
      const navigate = useNavigate();
      send = (inventoryTag) => navigate('/kiosk/inventory', { state: { inventoryNfcEvent: { uid: inventoryTag.uid, timestamp: new Date().toISOString(), inventoryTag, inventoryTagFromCache: inventoryTag.kind === 'ITEM' } } });
      return <KioskItemInventoryPage />;
    }
    render(<MemoryRouter initialEntries={['/kiosk/inventory']}><Routes><Route path="/kiosk/inventory" element={<Driver />} /><Route path="/kiosk/inventory/settings" element={<p>移動先</p>} /></Routes></MemoryRouter>);
    await act(async () => { send(tag); });
    if (operation === 'number') fireEvent.click(screen.getByRole('button', { name: '1個を払い出す' }));
    else await act(async () => { send(quantity); });
    fireEvent.click(screen.getByRole('link', { name: '在庫の準備' }));
    expect(screen.getByText('移動先')).toBeInTheDocument();
    await act(async () => { verification.resolve(tag); });
    expect(write).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not send touch after leaving during quantity re-resolution (header restock: %s)', async (restock) => {
    const { tag, quantity } = operationScenario();
    const lookup = deferred<InventoryTag | null>();
    vi.mocked(resolveInventoryTag).mockReset().mockReturnValueOnce(lookup.promise);
    const touch = vi.fn();
    const write = vi.fn();
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: write }, touchTransaction: { mutateAsync: touch } } as never);
    const drawer = { ...tag.compartment!, itemTagUid: restock ? tag.uid : null };
    vi.mocked(useInventoryItems).mockReturnValue({ data: [{ ...drawer.item, compartments: [drawer] }] } as never);
    let send: () => void = () => undefined;
    function Driver() {
      const navigate = useNavigate();
      send = () => navigate('/kiosk/inventory', { state: { inventoryNfcEvent: { uid: quantity.uid, timestamp: new Date().toISOString(), inventoryTag: quantity } } });
      return <KioskItemInventoryPage />;
    }
    render(<MemoryRouter initialEntries={['/kiosk/inventory']}><Routes><Route path="/kiosk/inventory" element={<Driver />} /><Route path="/kiosk/inventory/settings" element={<p>移動先</p>} /></Routes></MemoryRouter>);
    fireEvent.click(within(screen.getByLabelText('登録済みアイテム')).getByRole('button', { name: new RegExp(drawer.item.name) }));
    if (restock) fireEvent.click(screen.getByRole('button', { name: '補充' }));
    await act(async () => { send(); });
    expect(resolveInventoryTag).toHaveBeenCalledExactlyOnceWith(quantity.uid);
    fireEvent.click(screen.getByRole('link', { name: '在庫の準備' }));
    expect(screen.getByText('移動先')).toBeInTheDocument();
    await act(async () => { lookup.resolve({ ...quantity, quantity: 5 }); });
    expect(touch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each([false, true])('passes delayed hub scans through the router and page, discarding them only after failure (success: %s)', async (success) => {
    const { tag, quantity, transaction, suffix } = operationScenario();
    const request = deferred<{ transaction: ReturnType<typeof transaction> }>();
    const classification = deferred<InventoryTag | null>();
    const touch = vi.fn().mockReturnValueOnce(request.promise);
    const write = vi.fn().mockResolvedValue({ transaction: transaction({ id: `${suffix}-queued-transaction`, beforeQuantity: 9, afterQuantity: 7 }) });
    const refreshedItems = [{ ...tag.compartment!.item, compartments: [{ ...tag.compartment!, stockQuantity: 9 }] }] as InventoryItem[];
    const refetch = vi.fn().mockResolvedValue({ data: refreshedItems });
    vi.mocked(useInventoryItems).mockReturnValue({ data: [], refetch } as never);
    vi.mocked(useInventoryMutations).mockReturnValue({ transaction: { mutateAsync: write }, touchTransaction: { mutateAsync: touch } } as never);
    vi.mocked(resolveInventoryTag).mockReset().mockImplementation((uid) => uid === tag.uid ? Promise.resolve(tag) : classification.promise);
    window.sessionStorage.clear();
    const previousAgent = window.navigator.userAgent;
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux armv7l) Chrome/120', configurable: true });
    vi.stubEnv('VITE_AGENT_WS_MODE', 'local');
    let socket: { close: ReturnType<typeof vi.fn>; onmessage?: (message: MessageEvent) => void } = { close: vi.fn() };
    vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function () { socket = { close: vi.fn() }; return socket; }));
    const eventIdBase = 8000 + scenarioNumber * 10;
    const delivered: NfcEvent[] = [];
    function Probe() {
      const event = useNfcStream(true, undefined, { role: 'inventory', inventoryQueryClient: queryClient });
      useEffect(() => { if (event) delivered.push(event); }, [event]);
      return null;
    }
    const view = render(<MemoryRouter initialEntries={['/kiosk/inventory']}><InventoryNfcRouter /><Probe /><Routes><Route path="/kiosk/inventory" element={<KioskItemInventoryPage />} /></Routes></MemoryRouter>);
    queryClient.setQueryData(['inventory-tags'], [tag, quantity]);
    queryClient.setQueryData(['inventory-items'], [{ ...tag.compartment!.item, compartments: [tag.compartment!] }]);
    const send = (uid: string, eventId: number) => socket.onmessage?.({ data: JSON.stringify({ uid, eventId, receivedAt: -1, timestamp: new Date(Date.now() + 1000).toISOString() }) } as MessageEvent);
    try {
      await act(async () => { send(tag.uid, eventIdBase + 1); });
      await waitFor(() => expect(screen.getByRole('button', { name: '1個を払い出す' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: '1個を払い出す' }));
      expect(touch).toHaveBeenCalledOnce();
      const beforeScans = performance.now();
      await act(async () => {
        send(`${suffix}-unknown-X`, eventIdBase + 2);
        // A successful issue requires the next ITEM before its QUANTITY.
        if (success) send(tag.uid, eventIdBase + 3);
        send(quantity.uid, eventIdBase + 4);
      });
      await waitFor(() => expect(resolveInventoryTag).toHaveBeenCalledWith(`${suffix}-unknown-X`));
      expect(delivered.map((event) => event.uid)).toEqual([tag.uid]);
      await act(async () => {
        if (success) request.resolve({ transaction: transaction({ id: `${suffix}-touch-transaction`, delta: -1, afterQuantity: 9 }) });
        else request.reject(new Error('Network Error'));
      });
      await waitFor(() => expect(screen.getByRole('button', { name: '一覧へ' })).toBeEnabled());
      expect(screen.getByLabelText('現在庫')).toHaveTextContent('9個');
      const beforeClassification = performance.now();
      await act(async () => { classification.resolve(null); });
      await waitFor(() => expect(delivered.at(-1)?.uid).toBe(quantity.uid));
      const receivedAt = delivered.at(-1)?.receivedAt;
      expect(receivedAt).toBeGreaterThanOrEqual(beforeScans);
      expect(receivedAt).toBeLessThanOrEqual(beforeClassification);
      if (success) {
        await waitFor(() => expect(write).toHaveBeenCalledOnce());
        expect(screen.getByLabelText('現在庫')).toHaveTextContent('7個');
      } else {
        expect(write).not.toHaveBeenCalled();
        expect(refetch).toHaveBeenCalledOnce();
        expect(screen.getByRole('alert')).toHaveTextContent('通信できませんでした。在庫数を確かめてください');
        // Scans received after failure still work.
        await act(async () => { send(quantity.uid, eventIdBase + 5); });
        await waitFor(() => expect(write).toHaveBeenCalledOnce());
        expect(screen.getByLabelText('現在庫')).toHaveTextContent('7個');
      }
      expect(touch).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      window.sessionStorage.clear();
      Object.defineProperty(window.navigator, 'userAgent', { value: previousAgent, configurable: true });
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
