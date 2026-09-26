import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInventoryItems, useInventoryMutations } from '../../../../api/hooks';

import { InventoryRegistrationTab } from './InventoryRegistrationTab';

import type { NfcEvent } from '../../../../hooks/useNfcStream';

const nfc = vi.hoisted(() => ({ event: null as NfcEvent | null }));

vi.mock('../../../../api/client', () => ({ inventoryThumbnailUrl: (value: string) => value, api: { get: vi.fn() } }));
vi.mock('../../../../api/hooks', () => ({
  useInventoryImports: vi.fn(() => ({
    data: [{
      id: 'import-1', sourceItemId: 2, area: '30007_KSJP-55', category: '治具', note: null, manifest: {}, status: 'PENDING', messages: [],
      photos: [{ id: 'photo-1', photoIndex: 1, filename: '2_photo_1.jpeg', photoUrl: '/p/1.jpg', sha256: 'x' }],
    }],
    isLoading: false,
  })),
  useInventoryImportMessages: vi.fn(() => ({ data: [] })),
  useInventoryLocations: vi.fn(() => ({
    data: [{
      id: 'shelf-1', area: '30007_KSJP-55', shelfNumber: 1,
      drawers: [
        { id: 'drawer-1', drawerNumber: 1, shelf: { area: '30007_KSJP-55', shelfNumber: 1 }, compartments: [{ id: 'c1' }] },
        { id: 'drawer-2', drawerNumber: 2, shelf: { area: '30007_KSJP-55', shelfNumber: 1 }, compartments: [] },
      ],
    }],
  })),
  useInventoryItems: vi.fn(() => ({ data: [], isLoading: false })),
  useInventoryMutations: vi.fn(),
}));
vi.mock('../../../../hooks/useNfcStream', () => ({
  useNfcStream: vi.fn((enabled: boolean) => (enabled ? nfc.event : null)),
}));

function press(groupName: string, digits: string) {
  const group = screen.getByRole('group', { name: groupName });
  for (const digit of digits) {
    fireEvent.click(Array.from(group.querySelectorAll('button')).find((button) => button.textContent === digit)!);
  }
}

describe('InventoryRegistrationTab', () => {
  const registerImport = vi.fn();

  beforeEach(() => {
    nfc.event = null;
    registerImport.mockReset().mockResolvedValue({});
    vi.mocked(useInventoryMutations).mockReturnValue({
      registerImport: { mutateAsync: registerImport, isPending: false },
      reorderImportPhotos: { mutateAsync: vi.fn(), isPending: false },
      deleteImportPhoto: { mutateAsync: vi.fn(), isPending: false },
      retryImport: { mutateAsync: vi.fn(), isPending: false },
    } as never);
  });

  it('registers a new item with touch, a held tag and the keypad only', async () => {
    const view = render(<InventoryRegistrationTab accessPassword="2520" />);

    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    expect(screen.getByLabelText('アイテム名')).toHaveValue('ItemlistRaspi 2');
    fireEvent.click(screen.getByRole('button', { name: '次へ：置き場所' }));
    fireEvent.click(screen.getByRole('button', { name: '棚1' }));
    expect(screen.getByRole('button', { name: '引出し1 使用中' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '引出し2' }));
    fireEvent.click(screen.getByRole('button', { name: '次へ：タグをかざす' }));
    expect(screen.getByText('新しいタグをリーダーにかざしてください')).toBeInTheDocument();

    nfc.event = { uid: 'new-item-tag', eventId: 1, timestamp: new Date().toISOString() } as NfcEvent;
    view.rerender(<InventoryRegistrationTab accessPassword="2520" />);
    expect(await screen.findByText('タグ new-item-tag を読み取りました')).toBeInTheDocument();
    press('最初の数のテンキー', '7');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録する' })); });

    expect(registerImport).toHaveBeenCalledWith({
      id: 'import-1',
      input: {
        mode: 'NEW_ITEM',
        itemId: undefined,
        name: 'ItemlistRaspi 2',
        model: '',
        usage: '',
        shelfId: 'shelf-1',
        drawerId: 'drawer-2',
        itemTagUid: 'new-item-tag',
        initialQuantity: 7,
      },
    });
    await waitFor(() => expect(screen.getByText('候補 #2 を登録しました')).toBeInTheDocument());
  });

  it('adds photos to an existing item without a place, tag or quantity', async () => {
    vi.mocked(useInventoryItems).mockReturnValue({
      data: [{ id: 'item-9', itemCode: 'RI-9', name: '既存治具', model: 'M-1', usage: '検査', category: null, area: null, note: null, photos: [], compartments: [] }],
      isLoading: false,
    } as never);
    render(<InventoryRegistrationTab accessPassword="2520" />);

    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    fireEvent.click(screen.getByRole('button', { name: '既存のアイテムに写真を追加' }));
    fireEvent.click(screen.getByRole('button', { name: /既存治具/ }));
    expect(screen.getByLabelText('型式')).toHaveValue('M-1');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '写真を追加して登録する' })); });

    expect(registerImport).toHaveBeenCalledWith({
      id: 'import-1',
      input: {
        mode: 'EXISTING_ITEM',
        itemId: 'item-9',
        name: '既存治具',
        model: 'M-1',
        usage: '検査',
        shelfId: undefined,
        drawerId: undefined,
        itemTagUid: undefined,
        initialQuantity: undefined,
      },
    });
  });

  it('asks before deleting a candidate photo', () => {
    render(<InventoryRegistrationTab accessPassword="2520" />);

    fireEvent.click(screen.getByRole('button', { name: '写真1を削除' }));

    expect(screen.getByText('この写真を消しますか？')).toBeInTheDocument();
    expect(vi.mocked(useInventoryMutations).mock.results.at(-1)?.value.deleteImportPhoto.mutateAsync).not.toHaveBeenCalled();
  });
});
