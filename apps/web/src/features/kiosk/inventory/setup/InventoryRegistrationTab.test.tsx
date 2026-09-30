import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInventoryItems, useInventoryLocations, useInventoryMutations } from '../../../../api/hooks';

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
      id: 'shelf-1', area: '30007_KSJP-55 北', shelfNumber: 1,
      drawers: [
        { id: 'drawer-1', drawerNumber: 1, shelf: { area: '30007_KSJP-55 北', shelfNumber: 1 }, compartments: [{ id: 'c1' }] },
        { id: 'drawer-2', drawerNumber: 2, shelf: { area: '30007_KSJP-55 北', shelfNumber: 1 }, compartments: [] },
      ],
    }],
  })),
  useInventoryItems: vi.fn(() => ({ data: [], isLoading: false })),
  useInventoryUnits: vi.fn(() => ({ data: [{ id: 'u1', name: '個' }, { id: 'u2', name: 'ケース' }] })),
  useInventoryToolFieldOptions: vi.fn(() => ({ data: { maker: ['OSG', '京セラ'], toolName: ['エンドミル'], workMaterial: ['S45C'], toolSize: [], model: ['SOMT140520ER-GM / PR1525'], usage: ['上面', '側面'] } })),
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
  const createShelf = vi.fn();
  const createDrawer = vi.fn();

  beforeEach(() => {
    nfc.event = null;
    registerImport.mockReset().mockResolvedValue({});
    createShelf.mockReset().mockResolvedValue({});
    createDrawer.mockReset().mockResolvedValue({});
    vi.mocked(useInventoryMutations).mockReturnValue({
      registerImport: { mutateAsync: registerImport, isPending: false },
      reorderImportPhotos: { mutateAsync: vi.fn(), isPending: false },
      deleteImportPhoto: { mutateAsync: vi.fn(), isPending: false },
      retryImport: { mutateAsync: vi.fn(), isPending: false },
      createShelf: { mutateAsync: createShelf, isPending: false },
      createDrawer: { mutateAsync: createDrawer, isPending: false },
      createUnit: { mutateAsync: vi.fn(), isPending: false },
    } as never);
  });

  it('registers a new item on one screen, ticking the checklist as each part is done', async () => {
    const view = render(<InventoryRegistrationTab accessPassword="2520" />);
    const register = screen.getByRole('button', { name: '登録する' });
    expect(register).toBeDisabled();
    expect(screen.getByText('あと 5 つ')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '写真を確認した' }));
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    expect(screen.getByLabelText('アイテム名')).toHaveValue('ItemlistRaspi 2');
    fireEvent.click(screen.getByRole('button', { name: '棚1' }));
    expect(screen.getByRole('button', { name: '引出し1 使用中' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '引出し2' }));
    expect(within(screen.getByRole('region', { name: 'アイテムタグ' })).getByRole('status')).toHaveTextContent('30007_KSJP-55 北・棚1・引出し2');
    expect(screen.getByText('あと 2 つ')).toBeInTheDocument();

    nfc.event = { uid: 'new-item-tag', eventId: 1, timestamp: new Date().toISOString() } as NfcEvent;
    view.rerender(<InventoryRegistrationTab accessPassword="2520" />);
    expect(await screen.findByText('タグ new-item-tag を読み取りました')).toBeInTheDocument();
    press('最初の数のテンキー', '7');
    expect(screen.getByText('登録できます')).toBeInTheDocument();
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
        unit: null,
        maker: '',
        toolName: '',
        workMaterial: '',
        toolSize: '',
      },
    });
    await waitFor(() => expect(screen.getByText('候補 #2 を登録しました')).toBeInTheDocument());
  });

  it('does not start reading a tag before a drawer is chosen', () => {
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    expect(within(screen.getByRole('region', { name: 'アイテムタグ' })).queryByRole('status')).not.toBeInTheDocument();
  });

  it('adds photos to an existing item without a place, tag or quantity', async () => {
    vi.mocked(useInventoryItems).mockReturnValue({
      data: [{ id: 'item-9', itemCode: 'RI-9', name: '既存治具', model: 'M-1', usage: '検査', category: null, area: null, note: null, unit: 'ケース', photos: [], compartments: [] }],
      isLoading: false,
    } as never);
    render(<InventoryRegistrationTab accessPassword="2520" />);

    fireEvent.click(screen.getByRole('button', { name: '写真を確認した' }));
    fireEvent.click(screen.getByRole('button', { name: '既存のアイテムに写真を追加' }));
    fireEvent.click(screen.getByRole('button', { name: /既存治具/ }));
    expect(screen.getByLabelText('型式')).toHaveValue('M-1');
    expect(screen.queryByRole('region', { name: '置き場所' })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録する' })); });

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
        unit: 'ケース',
        maker: '',
        toolName: '',
        workMaterial: '',
        toolSize: '',
      },
    });
  });

  it('makes the first shelf of a new area by touch when the area has no shelves', async () => {
    const locations = vi.mocked(useInventoryLocations).getMockImplementation();
    vi.mocked(useInventoryLocations).mockReturnValue({ data: [] } as never);
    try {
      render(<InventoryRegistrationTab accessPassword="2520" />);
      fireEvent.click(screen.getByRole('button', { name: '新規登録' }));

      expect(screen.getByText('このエリアの棚はまだありません')).toBeInTheDocument();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '＋ 棚1を作る' })); });

      expect(createShelf).toHaveBeenCalledWith({ area: '30007_KSJP-55 北', shelfNumber: 1 });
    } finally {
      vi.mocked(useInventoryLocations).mockImplementation(locations!);
    }
  });

  it('makes the next drawer of the chosen shelf by touch', async () => {
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.click(screen.getByRole('button', { name: '棚1' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '＋ 引出し3を作る' })); });

    expect(createDrawer).toHaveBeenCalledWith({ shelfId: 'shelf-1', drawerNumber: 3 });
  });

  it('registers a new item counted in cases when ケース is chosen', async () => {
    const view = render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '写真を確認した' }));
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.click(screen.getByRole('button', { name: 'ケース' }));
    fireEvent.click(screen.getByRole('button', { name: '棚1' }));
    fireEvent.click(screen.getByRole('button', { name: '引出し2' }));
    nfc.event = { uid: 'case-tag', eventId: 9, timestamp: new Date().toISOString() } as NfcEvent;
    view.rerender(<InventoryRegistrationTab accessPassword="2520" />);
    await screen.findByText('タグ case-tag を読み取りました');
    press('最初の数のテンキー', '3');
    expect(screen.getByText('3ケース')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録する' })); });

    expect(registerImport.mock.calls[0][0].input).toMatchObject({ unit: 'ケース', initialQuantity: 3 });
  });

  it('names the area by machine and direction, and can use another machine\'s shelf', async () => {
    const locations = vi.mocked(useInventoryLocations).getMockImplementation();
    vi.mocked(useInventoryLocations).mockReturnValue({
      data: [
        { id: 'shelf-9', area: '30041R_2MF-P 北', shelfNumber: 1, drawers: [] },
      ],
    } as never);
    try {
      render(<InventoryRegistrationTab accessPassword="2520" />);
      fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
      expect(await screen.findByRole('button', { name: '30007_KSJP-55 北' })).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(screen.getByRole('button', { name: '30007_KSJP-55 東' }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '＋ 棚1を作る' })); });
      expect(createShelf).toHaveBeenLastCalledWith({ area: '30007_KSJP-55 東', shelfNumber: 1 });

      fireEvent.click(screen.getByRole('button', { name: '30041R_2MF-P 北' }));
      expect(screen.getByRole('button', { name: '30041R_2MF-P 北' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: '棚1' })).toBeInTheDocument();
    } finally {
      vi.mocked(useInventoryLocations).mockImplementation(locations!);
    }
  });

  it('starts from the area used last time for the same machine', async () => {
    vi.mocked(useInventoryItems).mockReturnValue({
      data: [{ id: 'old', itemCode: 'RI-1', name: '前の治具', model: null, usage: null, category: null, area: '30007_KSJP-55', note: null, unit: null, photos: [],
        compartments: [{ id: 'c', stockQuantity: 1, area: '30007_KSJP-55 南', shelfNumber: 1, drawerNumber: 1, itemTagUid: 't', item: {} }] }],
      isLoading: false,
    } as never);
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));

    expect(await screen.findByRole('button', { name: '30007_KSJP-55 南' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('前回この加工機で使った場所')).toBeInTheDocument();
  });

  it('fills tool fields by typing or from values already used', async () => {
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.change(screen.getByRole('textbox', { name: '工具寸法' }), { target: { value: 'φ10' } });

    fireEvent.click(screen.getByRole('button', { name: '▼ 登録済みから選ぶ' }));
    const popup = screen.getByRole('dialog', { name: '登録済みの値から選ぶ' });
    fireEvent.click(within(within(popup).getByRole('group', { name: 'メーカー' })).getByRole('button', { name: 'OSG' }));
    fireEvent.click(within(within(popup).getByRole('group', { name: '被削材' })).getByRole('button', { name: 'S45C' }));

    expect(screen.getByRole('textbox', { name: 'メーカー' })).toHaveValue('OSG');
    expect(screen.getByRole('textbox', { name: '被削材' })).toHaveValue('S45C');
    expect(screen.getByRole('textbox', { name: '工具寸法' })).toHaveValue('φ10');
    fireEvent.click(within(within(popup).getByRole('group', { name: '型式' })).getByRole('button', { name: 'SOMT140520ER-GM / PR1525' }));
    fireEvent.click(within(within(popup).getByRole('group', { name: '用途' })).getByRole('button', { name: '側面' }));
    expect(screen.getByRole('textbox', { name: '型式' })).toHaveValue('SOMT140520ER-GM / PR1525');
    expect(screen.getByRole('textbox', { name: '用途' })).toHaveValue('側面');
  });

  it('asks before deleting a candidate photo', () => {
    render(<InventoryRegistrationTab accessPassword="2520" />);

    fireEvent.click(screen.getByRole('button', { name: '写真1を削除' }));

    expect(screen.getByText('この写真を消しますか？')).toBeInTheDocument();
    expect(vi.mocked(useInventoryMutations).mock.results.at(-1)?.value.deleteImportPhoto.mutateAsync).not.toHaveBeenCalled();
  });
});
