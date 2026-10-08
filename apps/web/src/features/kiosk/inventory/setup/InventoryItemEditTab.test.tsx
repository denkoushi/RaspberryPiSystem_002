import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveInventoryTag } from '../../../../api/client';
import { useInventoryItems, useInventoryMutations } from '../../../../api/hooks';

import { InventoryItemEditTab } from './InventoryItemEditTab';

import type { NfcEvent } from '../../../../hooks/useNfcStream';

const nfc = vi.hoisted(() => ({ event: null as NfcEvent | null }));
const area = '30007_KSJP-55';

vi.mock('../../../../api/client', () => ({ inventoryThumbnailUrl: (value: string) => value, resolveInventoryTag: vi.fn(), api: { get: vi.fn() } }));
vi.mock('../../../../api/hooks', () => ({
  useInventoryItems: vi.fn(() => ({
    data: [{
      id: 'item-1', itemCode: 'RI-1', name: '治具A', model: null, usage: null, maker: 'OSG', category: null, area, note: null,
      photos: [{ id: 'photo-1', photoIndex: 1, photoUrl: '/p/1.jpg', originalFilename: 'a.jpg' }],
      compartments: [{ id: 'comp-1', stockQuantity: 5, area, shelfNumber: 1, drawerNumber: 1, itemTagUid: 'tag-1', item: {} }],
    }, {
      id: 'item-2', itemCode: 'RI-2', name: 'ItemlistRaspi 7', model: null, usage: null, category: null, area, note: null, photos: [], compartments: [],
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
  useInventoryUnits: vi.fn(() => ({ data: [{ id: 'u1', name: '個' }, { id: 'u2', name: 'ケース' }] })),
  useInventoryToolFieldOptions: vi.fn(() => ({ data: { name: ['チップ', '治具A'], maker: ['OSG', '京セラ'], toolName: [], workMaterial: [], toolSize: [], model: [], usage: [] } })),
  useInventoryToolFieldValues: vi.fn(() => ({ data: { name: [{ value: '治具A', count: 1 }], maker: [], toolName: [], workMaterial: [], toolSize: [], model: [], usage: [] } })),
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
    vi.mocked(resolveInventoryTag).mockReset().mockResolvedValue(null);
    mutations = {
      replaceTag: mutation(), move: mutation(), bindCompartment: mutation(), deleteItemPhoto: mutation(), reorderItemPhotos: mutation(), deleteItem: mutation(),
      setItemUnit: mutation(), createUnit: mutation(), updateItemDetails: mutation(),
      renameToolFieldValue: mutation(), addToolFieldValue: mutation(), deleteToolFieldValue: mutation(),
    };
    vi.mocked(useInventoryMutations).mockReturnValue(mutations as never);
  });

  it('moves a compartment to a free drawer in the same area', async () => {
    render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    fireEvent.click(screen.getByRole('button', { name: '別の引き出しへ移す' }));

    expect(screen.queryByRole('button', { name: '棚1 引き出し1' })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '棚1 引き出し2' })); });

    expect(mutations.move.mutateAsync).toHaveBeenCalledWith({ id: 'comp-1', drawerId: 'drawer-2' });
    expect(screen.getByText('棚1 / 引き出し2 へ移しました')).toBeInTheDocument();
  });

  it('adds another drawer with a held tag and a keypad count', async () => {
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    fireEvent.click(screen.getByRole('button', { name: '別の引き出しにも置く' }));
    fireEvent.click(screen.getByRole('button', { name: '引き出し2' }));

    nfc.event = { uid: 'new-tag', eventId: 5, timestamp: new Date().toISOString() } as NfcEvent;
    view.rerender(<InventoryItemEditTab accessPassword="2520" />);
    expect(await screen.findByText('new-tag')).toBeInTheDocument();
    const keypad = screen.getByRole('group', { name: '入っている数のテンキー' });
    fireEvent.click(Array.from(keypad.querySelectorAll('button')).find((button) => button.textContent === '4')!);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'この引き出しを追加する' })); });

    expect(mutations.bindCompartment.mutateAsync).toHaveBeenCalledWith({ itemId: 'item-1', shelfId: 'shelf-1', drawerId: 'drawer-2', itemTagUid: 'new-tag', initialQuantity: 4 });
  });

  it('changes the unit the item is counted in', async () => {
    render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    expect(screen.getByRole('button', { name: '個' })).toHaveAttribute('aria-pressed', 'true');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ケース' })); });

    expect(mutations.setItemUnit.mutateAsync).toHaveBeenCalledWith({ itemId: 'item-1', unit: 'ケース' });
    expect(screen.getByText('単位を「ケース」にしました')).toBeInTheDocument();
  });

  it('changes one field of the open item with a tap and can take it back', async () => {
    render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    const makers = within(screen.getByRole('group', { name: 'メーカー' }));
    expect(makers.getByRole('button', { name: 'OSG' })).toHaveAttribute('aria-pressed', 'true');

    await act(async () => { fireEvent.click(makers.getByRole('button', { name: '京セラ' })); });
    expect(mutations.updateItemDetails.mutateAsync).toHaveBeenCalledWith({ itemId: 'item-1', details: { maker: '京セラ' } });
    expect(screen.getByRole('status')).toHaveTextContent('メーカーを「京セラ」にしました');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '元に戻す' })); });
    expect(mutations.updateItemDetails.mutateAsync).toHaveBeenLastCalledWith({ itemId: 'item-1', details: { maker: 'OSG' } });
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
  });

  it('keeps a registered item named: a second tap or an emptied field does not clear the name', async () => {
    render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    const names = within(screen.getByRole('group', { name: '名前' }));

    fireEvent.click(names.getByRole('button', { name: '治具A' }));
    fireEvent.change(names.getByRole('textbox', { name: '名前の値' }), { target: { value: '' } });
    fireEvent.blur(names.getByRole('textbox', { name: '名前の値' }));

    expect(mutations.updateItemDetails.mutateAsync).not.toHaveBeenCalled();
    expect(names.getByRole('textbox', { name: '名前の値' })).toHaveValue('治具A');
  });

  it('marks provisional names, lists only those on request, and names one from the board', async () => {
    render(<InventoryItemEditTab accessPassword="2520" />);
    const list = within(screen.getByRole('navigation', { name: 'アイテム一覧' }));
    fireEvent.click(list.getByRole('button', { name: '仮名だけ 1件' }));
    expect(list.queryByRole('button', { name: /治具A/ })).not.toBeInTheDocument();

    fireEvent.click(list.getByRole('button', { name: /ItemlistRaspi 7/ }));
    const names = within(screen.getByRole('group', { name: '名前' }));
    expect(names.getByRole('textbox', { name: '名前の値' })).toHaveValue('');
    await act(async () => { fireEvent.click(names.getByRole('button', { name: 'チップ' })); });

    expect(mutations.updateItemDetails.mutateAsync).toHaveBeenCalledWith({ itemId: 'item-2', details: { name: 'チップ' } });
  });

  it('asks before deleting the item', async () => {
    render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));

    fireEvent.click(screen.getByRole('button', { name: 'アイテムを削除' }));
    expect(mutations.deleteItem.mutateAsync).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '削除する' })); });

    expect(mutations.deleteItem.mutateAsync).toHaveBeenCalledWith('item-1');
  });
  it('opens a registered item by NFC even when it is filtered out', async () => {
    vi.mocked(resolveInventoryTag).mockResolvedValue({ kind: 'ITEM', compartment: { item: { id: 'item-1' } } } as never);
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.change(screen.getByLabelText('品名・型式で絞り込む'), { target: { value: '見つからない名前' } });
    nfc.event = { uid: 'tag-1', eventId: 1, timestamp: '2026-10-08' } as NfcEvent;
    await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
    expect(resolveInventoryTag).toHaveBeenCalledWith('tag-1');
    expect(screen.getByRole('region', { name: '写真' })).toHaveTextContent('治具A');
    expect(screen.getByText('品物を開きました')).toBeInTheDocument();
  });
  it('ignores a tag lookup that answers after an item was picked by hand', async () => {
    let answer: (tag: unknown) => void = () => undefined;
    vi.mocked(resolveInventoryTag).mockReturnValue(new Promise((resolve) => { answer = resolve; }) as never);
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    nfc.event = { uid: 'tag-1', eventId: 1, timestamp: '2026-10-08' } as NfcEvent;
    await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
    fireEvent.click(screen.getAllByRole('button', { pressed: false }).find((button) => button.textContent?.includes('治具A'))!);
    await act(async () => { answer({ kind: 'ITEM', compartment: { item: { id: 'item-1' } } }); });
    expect(screen.queryByText('品物を開きました')).not.toBeInTheDocument();
  });

  it.each([['QUANTITY', '数量タグです'], ['RESTOCK', '補充タグです'], [null, '未登録のタグです']])('only reports %s tags without changing the open item', async (kind, message) => {
    vi.mocked(resolveInventoryTag).mockResolvedValue(kind ? { kind, compartment: null } as never : null);
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    nfc.event = { uid: 'other-tag', eventId: 1, timestamp: '2026-10-08' } as NfcEvent;
    await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '写真' })).toHaveTextContent('治具A');
    expect(mutations.replaceTag.mutateAsync).not.toHaveBeenCalled();
  });

  it('replaces the tag of the selected compartment with the next held UID', async () => {
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'タグを交換' }));
    nfc.event = { uid: 'replacement', eventId: 2, timestamp: '2026-10-08' } as NfcEvent;
    await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
    expect(mutations.replaceTag.mutateAsync).toHaveBeenCalledWith({ id: 'comp-1', uid: 'replacement' });
    expect(resolveInventoryTag).not.toHaveBeenCalled();
    expect(screen.getByText('タグを交換しました')).toBeInTheDocument();
  });

  it('shows a failed tag replacement at the scanner and keeps waiting', async () => {
    mutations.replaceTag.mutateAsync.mockRejectedValue({ response: { data: { errorCode: 'TAG_ALREADY_REGISTERED', message: 'このタグは使用中です' } } });
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'タグを交換' }));
    nfc.event = { uid: 'used', eventId: 2, timestamp: '2026-10-08' } as NfcEvent;
    await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
    expect(screen.getByRole('region', { name: '置き場所' })).toContainElement(screen.getByRole('alert'));
    expect(screen.getByRole('alert')).toHaveTextContent('このタグは使用中です');
    expect(screen.getByText('新しい品物タグ')).toBeInTheDocument();
  });

  it('refreshes a stale item list when a registered tag belongs to an item missing from the cache', async () => {
    const original = vi.mocked(useInventoryItems).getMockImplementation()!;
    const loaded = original();
    const refetch = vi.fn().mockImplementation(async () => {
      vi.mocked(useInventoryItems).mockReturnValue(loaded);
      return { data: loaded.data };
    });
    vi.mocked(useInventoryItems).mockReturnValue({ data: [], isLoading: false, refetch } as never);
    vi.mocked(resolveInventoryTag).mockResolvedValue({ kind: 'ITEM', compartment: { item: { id: 'item-1' } } } as never);
    try {
      const view = render(<InventoryItemEditTab accessPassword="2520" />);
      nfc.event = { uid: 'tag-1', eventId: 1, timestamp: '2026-10-08' } as NfcEvent;
      await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
      expect(refetch).toHaveBeenCalledWith({ throwOnError: true });
      expect(screen.getByRole('region', { name: '写真' })).toHaveTextContent('治具A');
    } finally { vi.mocked(useInventoryItems).mockImplementation(original); }
  });

  it('ignores item-opening scans while an added drawer quantity is being entered', async () => {
    vi.mocked(resolveInventoryTag).mockResolvedValue({ kind: 'ITEM', compartment: { item: { id: 'item-2' } } } as never);
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    fireEvent.click(screen.getByRole('button', { name: '別の引き出しにも置く' }));
    fireEvent.click(screen.getByRole('button', { name: '引き出し2' }));
    nfc.event = { uid: 'add-tag', eventId: 1, timestamp: '2026-10-08' } as NfcEvent;
    await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
    fireEvent.click(within(screen.getByRole('group', { name: '入っている数のテンキー' })).getByRole('button', { name: '5', exact: true }));
    nfc.event = { uid: 'item-tag', eventId: 2, timestamp: '2026-10-08' } as NfcEvent;
    await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
    expect(resolveInventoryTag).not.toHaveBeenCalled();
    expect(screen.getByLabelText('入っている数')).toHaveTextContent('5');
    expect(screen.getByRole('region', { name: '写真' })).toHaveTextContent('治具A');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'この引き出しを追加する' })); });
    expect(mutations.bindCompartment.mutateAsync).toHaveBeenCalledWith({ itemId: 'item-1', shelfId: 'shelf-1', drawerId: 'drawer-2', itemTagUid: 'add-tag', initialQuantity: 5 });
  });

  it.each(['add', 'replace'])('uses the %s waiting mode without opening another item', async (mode) => {
    vi.mocked(resolveInventoryTag).mockResolvedValue({ kind: 'ITEM', compartment: { item: { id: 'item-2' } } } as never);
    let finish!: (value: object) => void;
    if (mode === 'replace') mutations.replaceTag.mutateAsync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    if (mode === 'add') {
      fireEvent.click(screen.getByRole('button', { name: '別の引き出しにも置く' }));
      fireEvent.click(screen.getByRole('button', { name: '引き出し2' }));
    } else fireEvent.click(screen.getByRole('button', { name: 'タグを交換' }));
    nfc.event = { uid: 'item-tag', eventId: 1, timestamp: '2026-10-08' } as NfcEvent;
    await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
    expect(resolveInventoryTag).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: '写真' })).toHaveTextContent('治具A');
    if (mode === 'add') expect(screen.getByLabelText('入っている数')).toBeInTheDocument();
    else {
      expect(mutations.replaceTag.mutateAsync).toHaveBeenCalledWith({ id: 'comp-1', uid: 'item-tag' });
      nfc.event = { uid: 'next-item-tag', eventId: 2, timestamp: '2026-10-08' } as NfcEvent;
      await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
      expect(mutations.replaceTag.mutateAsync).toHaveBeenCalledTimes(1);
      expect(resolveInventoryTag).not.toHaveBeenCalled();
      await act(async () => { finish({}); });
    }
  });

  it('does not open an item while a location panel or text input is open', async () => {
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    const input = screen.getByRole('textbox', { name: '名前の値' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '書きかけ' } });
    nfc.event = { uid: 'item-tag', eventId: 1, timestamp: '2026-10-08' } as NfcEvent;
    await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
    expect(resolveInventoryTag).not.toHaveBeenCalled();
    expect(input).toHaveValue('書きかけ');
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: '別の引き出しにも置く' }));
    nfc.event = { uid: 'item-tag-2', eventId: 2, timestamp: '2026-10-08' } as NfcEvent;
    await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
    expect(resolveInventoryTag).not.toHaveBeenCalled();
    expect(screen.getByLabelText('追加する引き出し')).toBeInTheDocument();
  });

});
