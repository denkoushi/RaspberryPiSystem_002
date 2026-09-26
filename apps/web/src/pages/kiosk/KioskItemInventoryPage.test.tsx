import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { resolveInventoryTag, type InventoryItem, type InventoryTag } from '../../api/client';
import { useInventoryItems, useInventoryMutations } from '../../api/hooks';

import { KioskItemInventoryPage } from './KioskItemInventoryPage';

import type { NfcEvent } from '../../hooks/useNfcStream';


vi.mock('../../api/client', () => ({ resolveInventoryTag: vi.fn(), inventoryThumbnailUrl: (value: string) => value }));
vi.mock('../../api/hooks', () => ({
  useInventoryMutations: vi.fn(),
  useInventoryItems: vi.fn(() => ({ data: [], isLoading: false })),
  useInventoryCompartmentHistory: vi.fn(() => ({ data: [], isLoading: false })),
}));

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
    expect(screen.getByText(/8個/)).toBeInTheDocument();
    expect(screen.getByAltText('item.jpg')).toBeInTheDocument();

    await act(async () => {
      navigateToEvent?.({ uid: otherItemTag.uid, timestamp: new Date(Date.now() + 2).toISOString(), inventoryTag: otherItemTag });
    });
    expect(screen.getByText(/20個/)).toBeInTheDocument();
    await act(async () => { screen.getByRole('button', { name: '直前の取引を取消' }).click(); });
    await waitFor(() => expect(cancelMutateAsync).toHaveBeenCalledWith('transaction-id'));
    expect(screen.getByText(/20個/)).toBeInTheDocument();
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
    expect(screen.getByText('補充モード')).toBeInTheDocument();
    await act(async () => {
      navigateToEvent?.({ uid: itemTag.uid, timestamp: new Date(Date.now() + 1).toISOString(), inventoryTag: itemTag });
    });
    await act(async () => {
      navigateToEvent?.({ uid: quantityTag.uid, timestamp: new Date(Date.now() + 2).toISOString(), inventoryTag: quantityTag });
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ restock: true, restockTagUid: 'restock-uid' })));
    expect(screen.getByText(/補充しました/)).toBeInTheDocument();
    expect(screen.getByText(/12個/)).toBeInTheDocument();

    await act(async () => {
      navigateToEvent?.({ uid: 'restock-uid-2', timestamp: new Date(Date.now() + 3).toISOString(), inventoryTag: { id: 'restock-tag-2', uid: 'restock-uid-2', kind: 'RESTOCK', quantity: null, compartment: null } });
    });
    expect(screen.getByText('補充モード')).toBeInTheDocument();
    await act(async () => { screen.getByRole('button', { name: '選択をリセット' }).click(); });
    expect(screen.queryByText('補充モード')).not.toBeInTheDocument();
    expect(screen.getByText('アイテムNFCタグを読み取ってください')).toBeInTheDocument();

    vi.useFakeTimers();
    try {
      await act(async () => {
        navigateToEvent?.({ uid: 'restock-uid-3', timestamp: new Date(Date.now() + 4).toISOString(), inventoryTag: { id: 'restock-tag-3', uid: 'restock-uid-3', kind: 'RESTOCK', quantity: null, compartment: null } });
      });
      expect(screen.getByText('補充モード')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      expect(screen.queryByText('補充モード')).not.toBeInTheDocument();
      expect(screen.getByText('アイテムNFCタグを読み取ってください')).toBeInTheDocument();
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
  return async (tag: InventoryTag) => {
    tick += 1;
    await act(async () => { navigateToEvent?.({ uid: tag.uid, timestamp: new Date(Date.now() + tick).toISOString(), inventoryTag: tag }); });
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
    expect(screen.getByText('9個')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '直前の取引を取消' })); });
    expect(cancel).toHaveBeenCalledWith('correction-id');
    expect(screen.getByText('10個')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'タグが無いとき：置き場所から選ぶ' }));
    fireEvent.click(screen.getByRole('button', { name: /引出し2/ }));
    expect(screen.getByText('数量NFCタグを読み取ってください')).toBeInTheDocument();
    await scan(quantityTag);

    await waitFor(() => expect(transaction).toHaveBeenCalledWith(expect.objectContaining({ itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restock: false })));
  });

  it('does not take items out of a picked drawer that has no item tag', async () => {
    const transaction = vi.fn();
    vi.mocked(useInventoryMutations).mockReturnValue({
      transaction: { mutateAsync: transaction, isPending: false },
      cancel: { mutateAsync: vi.fn(), isPending: false },
      correction: { mutateAsync: vi.fn(), isPending: false },
    } as never);
    const untagged = { ...itemTag.compartment!, itemTagUid: null };
    vi.mocked(useInventoryItems).mockReturnValue({ data: [{ ...untagged.item, compartments: [untagged] }], isLoading: false } as never);
    const scan = renderWithNfc();

    fireEvent.click(screen.getByRole('button', { name: 'タグが無いとき：置き場所から選ぶ' }));
    fireEvent.click(screen.getByRole('button', { name: /引出し2/ }));
    await scan(quantityTag);

    await waitFor(() => expect(screen.getByText(/アイテムタグがないため/)).toBeInTheDocument());
    expect(transaction).not.toHaveBeenCalled();
  });
});
