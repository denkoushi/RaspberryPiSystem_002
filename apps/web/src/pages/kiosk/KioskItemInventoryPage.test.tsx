import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { resolveInventoryTag, type InventoryTag } from '../../api/client';
import { useInventoryMutations } from '../../api/hooks';

import { KioskItemInventoryPage } from './KioskItemInventoryPage';

import type { NfcEvent } from '../../hooks/useNfcStream';


vi.mock('../../api/client', () => ({ resolveInventoryTag: vi.fn(), inventoryThumbnailUrl: (value: string) => value }));
vi.mock('../../api/hooks', () => ({ useInventoryMutations: vi.fn() }));

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
    expect(screen.getByText(/現在庫 8個/)).toBeInTheDocument();
    expect(screen.getByAltText('item.jpg')).toBeInTheDocument();

    await act(async () => {
      navigateToEvent?.({ uid: otherItemTag.uid, timestamp: new Date(Date.now() + 2).toISOString(), inventoryTag: otherItemTag });
    });
    expect(screen.getByText(/現在庫 20個/)).toBeInTheDocument();
    await act(async () => { screen.getByRole('button', { name: '直前の取引を取消' }).click(); });
    await waitFor(() => expect(cancelMutateAsync).toHaveBeenCalledWith('transaction-id'));
    expect(screen.getByText(/現在庫 20個/)).toBeInTheDocument();
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
    expect(screen.getByText(/現在庫 12個/)).toBeInTheDocument();

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
