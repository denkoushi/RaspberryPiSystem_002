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
    expect(mutations.updateItemDetails.mutateAsync).toHaveBeenCalledWith({ itemId: 'item-1', details: { maker: 'OSG・京セラ' } });
    expect(screen.getByRole('status')).toHaveTextContent('メーカーを「OSG・京セラ」にしました');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '元に戻す' })); });
    expect(mutations.updateItemDetails.mutateAsync).toHaveBeenLastCalledWith({ itemId: 'item-1', details: { maker: 'OSG' } });
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
  });


  it('pages photos without reordering and keeps deletion and photo actions available', async () => {
    const original = vi.mocked(useInventoryItems).getMockImplementation()!;
    const data = original().data!;
    vi.mocked(useInventoryItems).mockReturnValue({ data: [{ ...data[0], photos: [...data[0].photos, { id: 'photo-2', photoIndex: 2, photoUrl: '/p/2.jpg', originalFilename: 'b.jpg' }] }], isLoading: false } as never);
    try {
      render(<InventoryItemEditTab accessPassword="2520" />);
      fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
      fireEvent.click(screen.getByRole('button', { name: '次の写真' }));
      expect(within(screen.getByRole('region', { name: '写真' })).getByAltText('b.jpg')).toBeInTheDocument();
      expect(screen.getByText('2/2')).toBeInTheDocument();
      expect(mutations.reorderItemPhotos.mutateAsync).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'アイテムを削除' })).toBeVisible();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '写真2を前へ' })); });
      expect(mutations.reorderItemPhotos.mutateAsync).toHaveBeenCalledWith({ itemId: 'item-1', photoIds: ['photo-2', 'photo-1'] });
      fireEvent.click(screen.getByRole('button', { name: '写真2を削除' }));
      expect(mutations.deleteItemPhoto.mutateAsync).not.toHaveBeenCalled();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '削除' })); });
      expect(mutations.deleteItemPhoto.mutateAsync).toHaveBeenCalledWith({ itemId: 'item-1', photoId: 'photo-2' });
      fireEvent.click(screen.getByRole('button', { name: '次の写真' }));
      expect(screen.getByText('1/2')).toBeInTheDocument();
    } finally { vi.mocked(useInventoryItems).mockImplementation(original); }
  });


  it('keeps successive selections while a details save is pending and sends them in order', async () => {
    let finish!: (value: object) => void;
    mutations.updateItemDetails.mutateAsync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    const makers = within(screen.getByRole('group', { name: 'メーカー' }));
    await act(async () => { fireEvent.click(makers.getByRole('button', { name: '京セラ' })); });
    fireEvent.click(makers.getByRole('button', { name: 'OSG' }));
    expect(makers.getByRole('textbox', { name: 'メーカーの値' })).toHaveValue('京セラ');
    expect(mutations.updateItemDetails.mutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => { finish({}); });
    expect(mutations.updateItemDetails.mutateAsync.mock.calls.map(([input]) => input.details.maker)).toEqual(['OSG・京セラ', '京セラ']);
  });

  it('restores the previous field value when saving a toggle fails', async () => {
    mutations.updateItemDetails.mutateAsync.mockRejectedValueOnce(new Error('保存できません'));
    render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    const makers = within(screen.getByRole('group', { name: 'メーカー' }));
    await act(async () => { fireEvent.click(makers.getByRole('button', { name: '京セラ' })); });
    expect(makers.getByRole('textbox', { name: 'メーカーの値' })).toHaveValue('OSG');
    expect(makers.getByRole('alert')).toHaveTextContent('保存できません');
  });

  it('keeps a deselection that matches the cache until all saves for that field settle', async () => {
    const original = vi.mocked(useInventoryItems).getMockImplementation()!;
    const data = original().data!;
    const finishes: Array<(value: object) => void> = [];
    mutations.updateItemDetails.mutateAsync.mockImplementation(() => new Promise((resolve) => { finishes.push(resolve); }));
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    const makers = within(screen.getByRole('group', { name: 'メーカー' }));
    const publishMaker = (maker: string) => {
      vi.mocked(useInventoryItems).mockReturnValue({ data: [{ ...data[0], maker }, data[1]], isLoading: false } as never);
      view.rerender(<InventoryItemEditTab accessPassword="2520" />);
    };
    try {
      await act(async () => { fireEvent.click(makers.getByRole('button', { name: '京セラ' })); });
      fireEvent.click(makers.getByRole('button', { name: '京セラ' }));
      expect(makers.getByRole('textbox', { name: 'メーカーの値' })).toHaveValue('OSG');
      expect(mutations.updateItemDetails.mutateAsync).toHaveBeenCalledTimes(1);

      // The first refetch contains the selection that the second queued save removes.
      publishMaker('OSG・京セラ');
      await act(async () => { finishes[0]({}); });
      expect(makers.getByRole('button', { name: '京セラ' })).toHaveAttribute('aria-pressed', 'false');
      expect(makers.getByRole('textbox', { name: 'メーカーの値' })).toHaveValue('OSG');
      fireEvent.click(makers.getByRole('button', { name: 'OSG' }));
      expect(makers.getByRole('textbox', { name: 'メーカーの値' })).toHaveValue('');

      publishMaker('OSG');
      await act(async () => { finishes[1]({}); });
      expect(makers.getByRole('textbox', { name: 'メーカーの値' })).toHaveValue('');
      expect(mutations.updateItemDetails.mutateAsync.mock.calls.map(([input]) => input.details.maker)).toEqual(['OSG・京セラ', 'OSG', '']);
      publishMaker('');
      await act(async () => { finishes[2]({}); });
      // Once settled, later server changes must be visible again.
      publishMaker('京セラ');
      expect(makers.getByRole('textbox', { name: 'メーカーの値' })).toHaveValue('京セラ');
    } finally { vi.mocked(useInventoryItems).mockImplementation(original); }
  });

  it('drops a failed optimistic field and uses the latest server value', async () => {
    const original = vi.mocked(useInventoryItems).getMockImplementation()!;
    const data = original().data!;
    let fail!: (reason: Error) => void;
    mutations.updateItemDetails.mutateAsync.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    const makers = within(screen.getByRole('group', { name: 'メーカー' }));
    try {
      await act(async () => { fireEvent.click(makers.getByRole('button', { name: '京セラ' })); });
      vi.mocked(useInventoryItems).mockReturnValue({ data: [{ ...data[0], maker: '京セラ' }], isLoading: false } as never);
      view.rerender(<InventoryItemEditTab accessPassword="2520" />);
      await act(async () => { fail(new Error('保存できません')); });
      expect(makers.getByRole('textbox', { name: 'メーカーの値' })).toHaveValue('京セラ');
      expect(makers.getByRole('alert')).toHaveTextContent('保存できません');
    } finally { vi.mocked(useInventoryItems).mockImplementation(original); }
  });

  it('resets optimistic fields when switching items while a save is pending', async () => {
    let finish!: (value: object) => void;
    mutations.updateItemDetails.mutateAsync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<InventoryItemEditTab accessPassword="2520" />);
    const list = within(screen.getByRole('navigation', { name: 'アイテム一覧' }));
    fireEvent.click(list.getByRole('button', { name: /治具A/ }));
    await act(async () => { fireEvent.click(within(screen.getByRole('group', { name: 'メーカー' })).getByRole('button', { name: '京セラ' })); });
    fireEvent.click(list.getByRole('button', { name: /ItemlistRaspi 7/ }));
    expect(within(screen.getByRole('group', { name: 'メーカー' })).getByRole('textbox', { name: 'メーカーの値' })).toHaveValue('');
    await act(async () => { finish({}); });
    expect(within(screen.getByRole('group', { name: 'メーカー' })).getByRole('textbox', { name: 'メーカーの値' })).toHaveValue('');
    expect(screen.queryByText('メーカーを「OSG・京セラ」にしました')).not.toBeInTheDocument();
    fireEvent.click(list.getByRole('button', { name: /治具A/ }));
    expect(within(screen.getByRole('group', { name: 'メーカー' })).getByRole('textbox', { name: 'メーカーの値' })).toHaveValue('OSG');
  });

  it('removes a selected component from a joined field', async () => {
    const original = vi.mocked(useInventoryItems).getMockImplementation()!;
    const data = original().data!;
    vi.mocked(useInventoryItems).mockReturnValue({ data: [{ ...data[0], maker: 'OSG・京セラ' }], isLoading: false } as never);
    try {
      render(<InventoryItemEditTab accessPassword="2520" />);
      fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
      const makers = within(screen.getByRole('group', { name: 'メーカー' }));
      expect(makers.getByRole('button', { name: '京セラ' })).toHaveAttribute('aria-pressed', 'true');
      await act(async () => { fireEvent.click(makers.getByRole('button', { name: 'OSG' })); });
      expect(mutations.updateItemDetails.mutateAsync).toHaveBeenCalledWith({ itemId: 'item-1', details: { maker: '京セラ' } });
    } finally { vi.mocked(useInventoryItems).mockImplementation(original); }
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

  it('shows an item deletion failure inside the confirmation overlay', async () => {
    mutations.deleteItem.mutateAsync.mockRejectedValueOnce(new Error('削除できません'));
    render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'アイテムを削除' }));
    const overlay = screen.getByRole('button', { name: '削除する' }).closest('.absolute')!;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '削除する' })); });
    expect(within(overlay as HTMLElement).getByRole('alert')).toHaveTextContent('削除できません');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '削除する' })).toBeEnabled();
  });

  it('keeps a photo error visible inside its confirmation overlay', async () => {
    mutations.reorderItemPhotos.mutateAsync.mockRejectedValueOnce(new Error('写真を変更できません'));
    const original = vi.mocked(useInventoryItems).getMockImplementation()!;
    const data = original().data!;
    vi.mocked(useInventoryItems).mockReturnValue({ data: [{ ...data[0], photos: [...data[0].photos, { ...data[0].photos[0], id: 'photo-2' }] }], isLoading: false } as never);
    try {
      render(<InventoryItemEditTab accessPassword="2520" />);
      fireEvent.click(within(screen.getByRole('navigation', { name: 'アイテム一覧' })).getByRole('button', { name: /治具A/ }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '写真1を後ろへ' })); });
      fireEvent.click(screen.getByRole('button', { name: '写真1を削除' }));
      const overlay = screen.getByRole('button', { name: '削除' }).closest('.absolute')!;
      expect(within(overlay as HTMLElement).getByRole('alert')).toHaveTextContent('写真を変更できません');
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    } finally { vi.mocked(useInventoryItems).mockImplementation(original); }
  });
  it('opens a registered item by NFC even when it is filtered out', async () => {
    vi.mocked(resolveInventoryTag).mockResolvedValue({ kind: 'ITEM', compartment: { item: { id: 'item-1' } } } as never);
    const view = render(<InventoryItemEditTab accessPassword="2520" />);
    fireEvent.change(screen.getByLabelText('品名・型式で絞り込む'), { target: { value: '見つからない名前' } });
    nfc.event = { uid: 'tag-1', eventId: 1, timestamp: '2026-10-08' } as NfcEvent;
    await act(async () => { view.rerender(<InventoryItemEditTab accessPassword="2520" />); });
    expect(resolveInventoryTag).toHaveBeenCalledWith('tag-1');
    expect(screen.getByRole('heading', { name: '治具A' })).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: '治具A' })).toBeInTheDocument();
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
      expect(screen.getByRole('heading', { name: '治具A' })).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: '治具A' })).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: '治具A' })).toBeInTheDocument();
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
