import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInventoryMutations } from '../../../../api/hooks';

import { InventoryItemEditTab } from './InventoryItemEditTab';

import type { NfcEvent } from '../../../../hooks/useNfcStream';

const nfc = vi.hoisted(() => ({ event: null as NfcEvent | null }));
const area = '30007_KSJP-55';

vi.mock('../../../../api/client', () => ({ inventoryThumbnailUrl: (value: string) => value, api: { get: vi.fn() } }));
vi.mock('../../../../api/hooks', () => ({
  useInventoryItems: vi.fn(() => ({
    data: [{
      id: 'item-1', itemCode: 'RI-1', name: '治具A', model: null, usage: null, category: null, area, note: null,
      photos: [{ id: 'photo-1', photoIndex: 1, photoUrl: '/p/1.jpg', originalFilename: 'a.jpg' }],
      compartments: [{ id: 'comp-1', stockQuantity: 5, area, shelfNumber: 1, drawerNumber: 1, itemTagUid: 'tag-1', item: {} }],
    }],
    isLoading: false,
  })),
  useInventoryLocations: vi.fn(() => ({
    data: [{
      id: 'shelf-1', area, shelfNumber: 1,
      drawers: [
        { id: 'drawer-1', drawerNumber: 1, shelf: { area, shelfNumber: 1 }, compartments: [{ id: 'comp-1' }] },
        { id: 'drawer-2', drawerNumber: 2, shelf: { area, shelfNumber: 1 }, compartments: [] },
      ],
    }],
  })),
  useInventoryMutations: vi.fn(),
}));
vi.mock('../../../../hooks/useNfcStream', () => ({
  useNfcStream: vi.fn((enabled: boolean) => (enabled ? nfc.event : null)),
}));

function mutation() {
  return { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false };
}

describe('InventoryItemEditTab', () => {
  let mutations: Record<string, ReturnType<typeof mutation>>;

  beforeEach(() => {
    nfc.event = null;
    mutations = {
      move: mutation(), bindCompartment: mutation(), deleteItemPhoto: mutation(), reorderItemPhotos: mutation(), deleteItem: mutation(),
    };
    vi.mocked(useInventoryMutations).mockReturnValue(mutations as never);
  });

  it('moves a compartment to a free drawer in the same area', async () => {
    render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: /治具A/ }));
    fireEvent.click(screen.getByRole('button', { name: '別の引き出しへ移す' }));

    expect(screen.queryByRole('button', { name: '棚1 引出し1' })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '棚1 引出し2' })); });

    expect(mutations.move.mutateAsync).toHaveBeenCalledWith({ id: 'comp-1', drawerId: 'drawer-2' });
    expect(screen.getByText('棚1 / 引出し2 へ移しました')).toBeInTheDocument();
  });

  it('adds another drawer with a held tag and a keypad count', async () => {
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: /治具A/ }));
    fireEvent.click(screen.getByRole('button', { name: '＋ 別の引き出しにも置く' }));
    fireEvent.click(screen.getByRole('button', { name: '引出し2' }));

    nfc.event = { uid: 'new-tag', eventId: 5, timestamp: new Date().toISOString() } as NfcEvent;
    view.rerender(<InventoryItemEditTab accessPassword="2520" />);
    expect(await screen.findByText(/タグ new-tag を読み取りました/)).toBeInTheDocument();
    const keypad = screen.getByRole('group', { name: '入っている数のテンキー' });
    fireEvent.click(Array.from(keypad.querySelectorAll('button')).find((button) => button.textContent === '4')!);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'この引き出しを追加する' })); });

    expect(mutations.bindCompartment.mutateAsync).toHaveBeenCalledWith({ itemId: 'item-1', shelfId: 'shelf-1', drawerId: 'drawer-2', itemTagUid: 'new-tag', initialQuantity: 4 });
  });

  it('asks before deleting the item', async () => {
    render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: /治具A/ }));

    fireEvent.click(screen.getByRole('button', { name: 'アイテムを削除' }));
    expect(mutations.deleteItem.mutateAsync).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '削除する' })); });

    expect(mutations.deleteItem.mutateAsync).toHaveBeenCalledWith('item-1');
  });
});
