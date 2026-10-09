import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInventoryImports, useInventoryItems, useInventoryLocations, useInventoryMutations, useInventoryToolFieldOptions } from '../../../../api/hooks';

import { InventoryRegistrationTab as RegistrationTab, type RegistrationState } from './InventoryRegistrationTab';

import type { NfcEvent } from '../../../../hooks/useNfcStream';

function InventoryRegistrationTab({ accessPassword, initialImportId = null }: { accessPassword: string; initialImportId?: string | null }) {
  const [registration, setRegistration] = useState<RegistrationState>({ selectedId: initialImportId, draft: null });
  const [visible, setVisible] = useState(true);
  return <><button onClick={() => setVisible((value) => !value)}>タブ切替</button>{visible ? <RegistrationTab accessPassword={accessPassword} registration={registration} setRegistration={setRegistration} /> : <p>ほかのタブ</p>}</>;
}

const nfc = vi.hoisted(() => ({ event: null as NfcEvent | null }));

vi.mock('../../../../api/client', () => ({ inventoryThumbnailUrl: (value: string) => value, api: { get: vi.fn() } }));
vi.mock('../../../../api/hooks', () => ({
  useInventoryImports: vi.fn(() => ({
    data: [{
      id: 'import-1', createdAt: '2026-10-01T00:00:00Z', sourceItemId: 2, area: '30007_KSJP-55', category: '治具', note: null, manifest: {}, status: 'PENDING', messages: [],
      photos: [{ id: 'photo-1', photoIndex: 1, filename: '2_photo_1.jpeg', photoUrl: '/p/1.jpg', sha256: 'x' }],
    }],
    isLoading: false,
  })),
  useInventoryImportMessages: vi.fn(() => ({ data: [] })),
  useInventoryLocations: vi.fn(() => ({
    data: [{
      id: 'shelf-1', area: '30007_KSJP-55 北', shelfNumber: 1,
      drawers: [
        { id: 'drawer-1', drawerNumber: 1, shelf: { area: '30007_KSJP-55 北', shelfNumber: 1 }, compartments: [{ id: 'c1', item: { name: '使用中' }, stockQuantity: 1 }] },
        { id: 'drawer-2', drawerNumber: 2, shelf: { area: '30007_KSJP-55 北', shelfNumber: 1 }, compartments: [] },
      ],
    }],
  })),
  useInventoryItems: vi.fn(() => ({ data: [], isLoading: false })),
  useInventoryUnits: vi.fn(() => ({ data: [{ id: 'u1', name: '個' }, { id: 'u2', name: 'ケース' }] })),
  useInventoryToolFieldOptions: vi.fn(() => ({ data: { name: ['チップ', 'ドリル'], maker: ['OSG', '京セラ'], toolName: ['エンドミル'], workMaterial: ['S45C'], toolSize: [], model: ['SOMT140520ER-GM / PR1525'], usage: ['上面', '側面'] } })),
  useInventoryToolFieldValues: vi.fn(() => ({ data: { name: [{ value: 'チップ', count: 23 }], maker: [{ value: 'OSG', count: 0 }, { value: 'ミツビシ', count: 3 }], toolName: [], workMaterial: [], toolSize: [], model: [], usage: [] } })),
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
  const dismissImport = vi.fn();
  const restoreImport = vi.fn();
  const registerImport = vi.fn();
  const createShelf = vi.fn();
  const createDrawer = vi.fn();
  const renameToolFieldValue = vi.fn();
  const deleteToolFieldValue = vi.fn();
  const addToolFieldValue = vi.fn();

  beforeEach(() => {
    nfc.event = null;
    dismissImport.mockReset().mockResolvedValue({});
    restoreImport.mockReset().mockResolvedValue({});
    registerImport.mockReset().mockResolvedValue({});
    createShelf.mockReset().mockResolvedValue({});
    createDrawer.mockReset().mockResolvedValue({});
    renameToolFieldValue.mockReset().mockResolvedValue({ field: 'maker', value: 'ミツビシマテリアル', updatedItems: 3 });
    deleteToolFieldValue.mockReset().mockResolvedValue({});
    addToolFieldValue.mockReset().mockResolvedValue({});
    vi.mocked(useInventoryMutations).mockReturnValue({
      dismissImport: { mutateAsync: dismissImport, isPending: false },
      restoreImport: { mutateAsync: restoreImport, isPending: false },
      registerImport: { mutateAsync: registerImport, isPending: false },
      reorderImportPhotos: { mutateAsync: vi.fn(), isPending: false },
      deleteImportPhoto: { mutateAsync: vi.fn(), isPending: false },
      retryImport: { mutateAsync: vi.fn(), isPending: false },
      createShelf: { mutateAsync: createShelf, isPending: false },
      createDrawer: { mutateAsync: createDrawer, isPending: false },
      renameArea: { mutateAsync: vi.fn(), isPending: false },
      createUnit: { mutateAsync: vi.fn(), isPending: false },
      renameToolFieldValue: { mutateAsync: renameToolFieldValue, isPending: false },
      addToolFieldValue: { mutateAsync: addToolFieldValue, isPending: false },
      deleteToolFieldValue: { mutateAsync: deleteToolFieldValue, isPending: false },
    } as never);
  });

  it('bounds both columns and scrolls choice groups with manual tag entry and the success banner open', async () => {
    const originalLocations = vi.mocked(useInventoryLocations).getMockImplementation()!;
    const originalImports = vi.mocked(useInventoryImports).getMockImplementation()!;
    const candidate = originalImports().data![0];
    const shelf = originalLocations().data![0];
    vi.mocked(useInventoryImports).mockReturnValue({ data: [candidate, { ...candidate, id: 'next', sourceItemId: 3 }], isLoading: false } as never);
    vi.mocked(useInventoryLocations).mockReturnValue({ data: [
      ...Array.from({ length: 16 }, (_, index) => ({
        ...shelf, id: `shelf-${index + 1}`, shelfNumber: index + 1,
        drawers: Array.from({ length: 16 }, (_, index) => ({ id: `drawer-${index + 1}`, drawerNumber: index + 1, compartments: [] })),
      })),
      ...Array.from({ length: 8 }, (_, index) => ({ ...shelf, id: `other-${index}`, area: `別の加工機${index} 北` })),
    ] } as never);
    try {
      render(<InventoryRegistrationTab accessPassword="2520" />);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録しない' })); });
      fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
      fireEvent.click(screen.getByRole('button', { name: '棚1' }));
      fireEvent.click(screen.getByRole('button', { name: '引き出し2' }));
      fireEvent.click(screen.getByRole('button', { name: 'IDを手で入れる' }));
      expect(screen.getByText('候補 #2 は登録しません')).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'タグのID' })).toBeVisible();
      const place = screen.getByRole('region', { name: '置き場所' });
      expect(place.parentElement).toHaveClass('h-full', 'min-h-0', 'flex-col');
      expect(place).toHaveClass('min-h-0', 'flex-1');
      expect(place.firstElementChild).toHaveClass('shrink-0');
      expect(place.lastElementChild).toHaveClass('min-h-0', 'flex-1');
      const groups = within(place).getAllByRole('group');
      expect(groups).toHaveLength(4);
      for (const group of groups) {
        expect(group).toHaveClass('min-h-0', 'flex-1', 'content-start', 'overflow-y-auto', '[&>button]:shrink-0');
        expect(group.parentElement).toHaveClass('min-h-0', 'flex-1');
      }
      for (const name of ['アイテムタグ', '最初の数']) {
        expect(screen.getByRole('region', { name })).toHaveClass('shrink-0');
      }
      expect(within(screen.getByRole('group', { name: '最初の数のテンキー' })).getAllByRole('button')).toHaveLength(12);
      const names = screen.getByRole('region', { name: '名前・工具情報' });
      expect(names.parentElement).toHaveClass('h-full', 'min-h-0', 'flex-col');
      expect(names).toHaveClass('min-h-0', 'flex-1');
      expect(screen.getByRole('textbox', { name: 'アイテム名' }).parentElement?.parentElement).toHaveClass('min-h-0', 'overflow-y-auto');
      expect(screen.getByRole('region', { name: '新規か既存か' })).toHaveClass('shrink-0');
      expect(screen.getByRole('region', { name: '単位' })).toHaveClass('shrink-0');
      expect(screen.getByRole('group', { name: '単位' }).parentElement).toHaveClass('max-h-36', 'overflow-y-auto');
    } finally {
      vi.mocked(useInventoryLocations).mockImplementation(originalLocations);
      vi.mocked(useInventoryImports).mockImplementation(originalImports);
    }
  });

  it('registers a new item on one screen, ticking the checklist as each part is done', async () => {
    const view = render(<InventoryRegistrationTab accessPassword="2520" />);
    const register = screen.getByRole('button', { name: '登録する' });
    expect(register).toBeDisabled();
    expect(screen.getByText('あと 4 つ')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '単位' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '新規か既存か' })).queryByLabelText('完了')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '名前・工具情報' })).getByLabelText('完了')).toHaveTextContent('✓');

    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    expect(screen.getByLabelText('アイテム名')).toHaveValue('ItemlistRaspi 2');
    fireEvent.click(screen.getByRole('button', { name: '棚1' }));
    expect(screen.getByRole('button', { name: '引き出し1 使用中' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '引き出し2' }));
    expect(within(screen.getByRole('region', { name: 'アイテムタグ' })).getByRole('status')).toHaveTextContent('30007_KSJP-55 北・棚1・引き出し2');
    expect(screen.getByText('あと 2 つ')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '置き場所' })).getByLabelText('完了')).toHaveTextContent('✓');
    expect(screen.getByLabelText('選んだ置き場所')).toHaveTextContent('30007_KSJP-55 北・棚1・引き出し2');

    nfc.event = { uid: 'new-item-tag', eventId: 1, timestamp: new Date().toISOString() } as NfcEvent;
    view.rerender(<InventoryRegistrationTab accessPassword="2520" />);
    expect(await screen.findByText('new-item-tag')).toBeInTheDocument();
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

      expect(screen.getByText(/の棚はまだありません/)).toBeInTheDocument();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '棚1を作る' })); });

      expect(createShelf).toHaveBeenCalledWith({ area: '30007_KSJP-55 北', shelfNumber: 1 });
    } finally {
      vi.mocked(useInventoryLocations).mockImplementation(locations!);
    }
  });

  it('makes the next drawer of the chosen shelf by touch', async () => {
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.click(screen.getByRole('button', { name: '棚1' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '引き出し3を作る' })); });

    expect(createDrawer).toHaveBeenCalledWith({ shelfId: 'shelf-1', drawerNumber: 3 });
  });

  it('registers a new item counted in cases when ケース is chosen', async () => {
    const view = render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.click(screen.getByRole('button', { name: 'ケース' }));
    fireEvent.click(screen.getByRole('button', { name: '棚1' }));
    fireEvent.click(screen.getByRole('button', { name: '引き出し2' }));
    nfc.event = { uid: 'case-tag', eventId: 9, timestamp: new Date().toISOString() } as NfcEvent;
    view.rerender(<InventoryRegistrationTab accessPassword="2520" />);
    await screen.findByText('case-tag');
    press('最初の数のテンキー', '3');
    expect(screen.getByRole('status', { name: '最初の数' })).toHaveTextContent('3');
    expect(within(screen.getByRole('region', { name: '最初の数' })).getByText('ケース')).toBeInTheDocument();
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
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '棚1を作る' })); });
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
    expect(screen.getByText('前回と同じ')).toBeInTheDocument();
  });

  it('fills tool fields by typing or from values already used', async () => {
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.change(screen.getByRole('textbox', { name: '工具寸法' }), { target: { value: 'φ10' } });

    fireEvent.click(screen.getByRole('button', { name: '登録済みから選ぶ' }));
    const popup = screen.getByRole('dialog', { name: '名前・工具情報' });
    fireEvent.click(within(within(popup).getByRole('group', { name: 'メーカー' })).getByRole('button', { name: 'OSG' }));
    fireEvent.click(within(within(popup).getByRole('group', { name: '被削材' })).getByRole('button', { name: 'S45C' }));

    fireEvent.click(within(within(popup).getByRole('group', { name: 'メーカー' })).getByRole('button', { name: '京セラ' }));
    expect(screen.getByRole('textbox', { name: 'メーカー' })).toHaveValue('OSG・京セラ');
    expect(screen.getByRole('textbox', { name: '被削材' })).toHaveValue('S45C');
    expect(screen.getByRole('textbox', { name: '工具寸法' })).toHaveValue('φ10');
    fireEvent.click(within(within(popup).getByRole('group', { name: '型式' })).getByRole('button', { name: 'SOMT140520ER-GM / PR1525' }));
    fireEvent.click(within(within(popup).getByRole('group', { name: '用途' })).getByRole('button', { name: '側面' }));
    expect(screen.getByRole('textbox', { name: '型式' })).toHaveValue('SOMT140520ER-GM / PR1525');
    expect(screen.getByRole('textbox', { name: '用途' })).toHaveValue('側面');

    // A second tap removes only that value.
    fireEvent.click(within(within(popup).getByRole('group', { name: 'メーカー' })).getByRole('button', { name: 'OSG' }));
    expect(screen.getByRole('textbox', { name: 'メーカー' })).toHaveValue('京セラ');
  });


  it('offers individual registered values once and toggles a joined field immediately', () => {
    const original = vi.mocked(useInventoryToolFieldOptions).getMockImplementation()!;
    vi.mocked(useInventoryToolFieldOptions).mockReturnValue({ data: { ...original().data, workMaterial: ['鋼・SUS', '鋼', 'アルミ'] } } as never);
    try {
      render(<InventoryRegistrationTab accessPassword="2520" />);
      fireEvent.click(screen.getByRole('button', { name: '登録済みから選ぶ' }));
      const lane = within(within(screen.getByRole('dialog', { name: '名前・工具情報' })).getByRole('group', { name: '被削材' }));
      expect(lane.getAllByRole('button', { name: '鋼', exact: true })).toHaveLength(1);
      expect(lane.queryByRole('button', { name: '鋼・SUS' })).not.toBeInTheDocument();
      fireEvent.click(lane.getByRole('button', { name: '鋼', exact: true }));
      fireEvent.click(lane.getByRole('button', { name: 'SUS' }));
      expect(screen.getByRole('textbox', { name: '被削材' })).toHaveValue('鋼・SUS');
      expect(lane.getByRole('button', { name: '鋼', exact: true })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(lane.getByRole('button', { name: '鋼', exact: true }));
      expect(screen.getByRole('textbox', { name: '被削材' })).toHaveValue('SUS');
    } finally { vi.mocked(useInventoryToolFieldOptions).mockImplementation(original); }
  });

  it('picks the name from the board, hides the provisional one, and goes back to it on a second tap', async () => {
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    expect(screen.getByRole('textbox', { name: 'アイテム名' })).toHaveValue('ItemlistRaspi 2');

    fireEvent.click(screen.getByRole('button', { name: '登録済みから選ぶ' }));
    const names = within(within(screen.getByRole('dialog', { name: '名前・工具情報' })).getByRole('group', { name: '名前' }));
    expect(names.getByText('仮名')).toBeInTheDocument();
    expect(names.getByRole('textbox', { name: '名前の値' })).toHaveValue('');

    fireEvent.click(names.getByRole('button', { name: 'チップ' }));
    expect(screen.getByRole('textbox', { name: 'アイテム名' })).toHaveValue('チップ');
    expect(names.queryByText('仮名')).not.toBeInTheDocument();

    fireEvent.click(names.getByRole('button', { name: 'チップ' }));
    expect(screen.getByRole('textbox', { name: 'アイテム名' })).toHaveValue('ItemlistRaspi 2');

    // Typed straight into the lane, the text is taken on leaving the field and kept as a choice.
    fireEvent.change(names.getByRole('textbox', { name: '名前の値' }), { target: { value: ' ﾘｰﾏ ' } });
    expect(names.getByRole('button', { name: '名前を確定' })).toBeInTheDocument();
    await act(async () => { fireEvent.blur(names.getByRole('textbox', { name: '名前の値' })); });
    expect(screen.getByRole('textbox', { name: 'アイテム名' })).toHaveValue('リーマ');
    expect(addToolFieldValue).toHaveBeenCalledWith({ field: 'name', value: 'リーマ' });
  });

  it('keeps a name and tool information entered before 新規登録 is pressed', async () => {
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '登録済みから選ぶ' }));
    const board = within(screen.getByRole('dialog', { name: '名前・工具情報' }));
    fireEvent.click(within(board.getByRole('group', { name: '名前' })).getByRole('button', { name: 'チップ' }));
    fireEvent.click(within(board.getByRole('group', { name: 'メーカー' })).getByRole('button', { name: 'OSG' }));
    fireEvent.click(board.getByRole('button', { name: '閉じる' }));

    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    expect(screen.getByRole('textbox', { name: 'アイテム名' })).toHaveValue('チップ');
    expect(screen.getByRole('textbox', { name: 'メーカー' })).toHaveValue('OSG');

    // Pressing it again changes nothing either.
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    expect(screen.getByRole('textbox', { name: 'アイテム名' })).toHaveValue('チップ');
  });

  it('renames a registered value together with the items that use it', async () => {
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'メーカー' }), { target: { value: 'ミツビシ' } });
    fireEvent.click(screen.getByRole('button', { name: '登録済みから選ぶ' }));
    fireEvent.click(screen.getByRole('button', { name: 'まとめて直す' }));
    const popup = screen.getByRole('dialog', { name: '名前・工具情報' });

    expect(within(popup).queryByRole('button', { name: 'ミツビシを削除' })).not.toBeInTheDocument();
    fireEvent.click(within(popup).getByRole('button', { name: 'ミツビシの名前を変える' }));
    expect(within(popup).getByText(/件が変わります/)).toHaveTextContent('3件が変わります');
    fireEvent.change(within(popup).getByRole('textbox', { name: 'ミツビシの新しい名前' }), { target: { value: 'ミツビシマテリアル' } });
    await act(async () => { fireEvent.click(within(popup).getByRole('button', { name: '変える' })); });

    expect(renameToolFieldValue).toHaveBeenCalledWith({ field: 'maker', from: 'ミツビシ', to: 'ミツビシマテリアル' });
    expect(screen.getByRole('textbox', { name: 'メーカー' })).toHaveValue('ミツビシマテリアル');
  });

  it('removes an unused value only after a second confirmation', async () => {
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.click(screen.getByRole('button', { name: '登録済みから選ぶ' }));
    fireEvent.click(screen.getByRole('button', { name: 'まとめて直す' }));
    const popup = screen.getByRole('dialog', { name: '名前・工具情報' });

    fireEvent.click(within(popup).getByRole('button', { name: 'OSGを削除' }));
    expect(deleteToolFieldValue).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(popup).getByRole('button', { name: '削除' })); });
    expect(deleteToolFieldValue).toHaveBeenCalledWith({ field: 'maker', value: 'OSG' });
  });

  it('asks before deleting a candidate photo', () => {
    render(<InventoryRegistrationTab accessPassword="2520" />);

    fireEvent.click(screen.getByRole('button', { name: '写真1を削除' }));

    expect(screen.getByText('この写真を削除しますか？')).toBeInTheDocument();
    expect(vi.mocked(useInventoryMutations).mock.results.at(-1)?.value.deleteImportPhoto.mutateAsync).not.toHaveBeenCalled();
  });

  it('lists candidates newest first in the strip below and opens the one chosen on the daily list', () => {
    const candidate = (id: string, sourceItemId: number, area: string, createdAt: string) => ({
      id, sourceItemId, area, category: null, note: null, manifest: {}, status: 'PENDING', messages: [], createdAt,
      photos: [{ id: `${id}-photo`, photoIndex: 1, filename: `${sourceItemId}_photo_1.jpeg`, photoUrl: `/p/${id}.jpg`, sha256: 'x' }],
    });
    const defaultImports = vi.mocked(useInventoryImports).getMockImplementation();
    vi.mocked(useInventoryImports).mockReturnValue({
      data: [candidate('p4', 4, '50013_540AP', '2026-09-17T05:40:04Z'), candidate('p5', 5, '30042S_FJV50/80', '2026-09-30T05:45:05Z')],
      isLoading: false,
    } as never);
    render(<InventoryRegistrationTab accessPassword="2520" initialImportId="p4" />);

    const strip = screen.getByRole('region', { name: 'メールで届いた候補' });
    const cards = within(strip).getAllByRole('button', { name: /^候補 #/ });
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual(['候補 #5', '候補 #4']);
    expect(cards[1]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('候補 #4')).toBeInTheDocument();
    vi.mocked(useInventoryImports).mockImplementation(defaultImports!);
  });
  it('preserves the selected candidate, typed fields and scanned tag across tab unmounting and new mail', async () => {
    const original = vi.mocked(useInventoryImports).getMockImplementation()!;
    const data = original().data!;
    vi.mocked(useInventoryItems).mockReturnValue({ data: [], isLoading: false } as never);
    const view = render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.change(screen.getByLabelText('アイテム名'), { target: { value: '作業中の治具' } });
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.click(screen.getByRole('button', { name: '棚1' }));
    fireEvent.click(screen.getByRole('button', { name: '引き出し2' }));
    nfc.event = { uid: 'retained-tag', eventId: 50, timestamp: new Date().toISOString() } as NfcEvent;
    view.rerender(<InventoryRegistrationTab accessPassword="2520" />);
    expect(await screen.findByText('retained-tag')).toBeInTheDocument();
    press('最初の数のテンキー', '12');
    fireEvent.click(screen.getByRole('button', { name: 'タブ切替' }));
    expect(screen.queryByRole('region', { name: '写真の確認' })).not.toBeInTheDocument();
    vi.mocked(useInventoryImports).mockReturnValue({ data: [{ ...data[0], id: 'new-mail', sourceItemId: 99, createdAt: '2099-01-01' }, ...data], isLoading: false } as never);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'タブ切替' }));
      expect(screen.getByRole('button', { name: '候補 #2' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: '候補 #99' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByLabelText('アイテム名')).toHaveValue('作業中の治具');
      expect(screen.getByText('retained-tag')).toBeInTheDocument();
      expect(screen.getByRole('status', { name: '最初の数' })).toHaveTextContent('12');
      expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: '写真を確認した' })).not.toBeInTheDocument();
      expect(screen.queryByRole('complementary', { name: '登録の進み具合' })).not.toBeInTheDocument();
    } finally { vi.mocked(useInventoryImports).mockImplementation(original); }
  });

  it('pins the first candidate even when new mail arrives without leaving the tab', () => {
    const original = vi.mocked(useInventoryImports).getMockImplementation()!;
    const data = original().data!;
    vi.mocked(useInventoryItems).mockReturnValue({ data: [], isLoading: false } as never);
    const view = render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.change(screen.getByLabelText('型式'), { target: { value: 'pending-model' } });
    vi.mocked(useInventoryImports).mockReturnValue({ data: [{ ...data[0], id: 'new-mail', sourceItemId: 99, createdAt: '2099-01-01' }, ...data], isLoading: false } as never);
    try {
      view.rerender(<InventoryRegistrationTab accessPassword="2520" />);
      expect(screen.getByRole('button', { name: '候補 #2' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByLabelText('型式')).toHaveValue('pending-model');
    } finally { vi.mocked(useInventoryImports).mockImplementation(original); }
  });

  it('advances to the next candidate after registering and clears the completed draft', async () => {
    const original = vi.mocked(useInventoryImports).getMockImplementation()!;
    const data = original().data!;
    vi.mocked(useInventoryImports).mockReturnValue({ data: [...data, { ...data[0], id: 'next', sourceItemId: 3, createdAt: '2026-09-01T00:00:00Z' }], isLoading: false } as never);
    vi.mocked(useInventoryItems).mockReturnValue({ data: [{ id: 'item-9', name: '既存治具', photos: [], compartments: [] }], isLoading: false } as never);
    try {
      render(<InventoryRegistrationTab accessPassword="2520" />);
      fireEvent.click(screen.getByRole('button', { name: '既存のアイテムに写真を追加' }));
      fireEvent.click(screen.getByRole('button', { name: /既存治具/ }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録する' })); });
      expect(registerImport).toHaveBeenCalledWith(expect.objectContaining({ id: 'import-1' }));
      expect(screen.getByRole('button', { name: '候補 #3' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByLabelText('アイテム名')).toHaveValue('ItemlistRaspi 3');
      expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled();
    } finally { vi.mocked(useInventoryImports).mockImplementation(original); }
  });

  it('dismisses the selected candidate immediately, advances, and restores its draft', async () => {
    vi.mocked(useInventoryImports).mockReturnValue({ data: [
      { id: 'a', sourceItemId: 10, area: '機械A', createdAt: '2026-10-08', photos: [] },
      { id: 'b', sourceItemId: 9, area: '機械B', createdAt: '2026-10-07', photos: [] },
    ], isLoading: false } as never);
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.change(screen.getByLabelText('アイテム名'), { target: { value: '書きかけの品名' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録しない' })); });
    expect(dismissImport).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('button', { name: '候補 #10' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '候補 #9' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('アイテム名')).toHaveValue('ItemlistRaspi 9');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '元に戻す' })); });
    expect(restoreImport).toHaveBeenCalledWith('a');
    expect(screen.getByRole('button', { name: '候補 #10' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('アイテム名')).toHaveValue('書きかけの品名');
  });

  it('offers undo even after dismissing the last candidate', async () => {
    vi.mocked(useInventoryImports).mockReturnValue({ data: [{ id: 'last', sourceItemId: 1, area: '機械', createdAt: '2026-10-08', photos: [] }], isLoading: false } as never);
    render(<InventoryRegistrationTab accessPassword="2520" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録しない' })); });
    expect(screen.getByText('登録待ちの候補はありません')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '元に戻す' })); });
    expect(screen.getByRole('button', { name: '候補 #1' })).toBeInTheDocument();
  });

  it('reports a failed dismissal beside its button without losing the draft', async () => {
    vi.mocked(useInventoryImports).mockReturnValue({ data: [{ id: 'last', sourceItemId: 1, area: '機械', createdAt: '2026-10-08', photos: [] }], isLoading: false } as never);
    dismissImport.mockRejectedValue({ response: { data: { errorCode: 'CONFLICT', message: '別の端末で登録済みです' } } });
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.change(screen.getByLabelText('アイテム名'), { target: { value: '下書き' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録しない' })); });
    expect(screen.getByRole('button', { name: '登録しない' }).parentElement).toContainElement(screen.getByRole('alert'));
    expect(screen.getByLabelText('アイテム名')).toHaveValue('下書き');
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
  });

  it('clears dismissal undo when another candidate is dismissed or the tab is left', async () => {
    vi.mocked(useInventoryImports).mockReturnValue({ data: [
      { id: 'a', sourceItemId: 10, area: '機械A', createdAt: '2026-10-08', photos: [] },
      { id: 'b', sourceItemId: 9, area: '機械B', createdAt: '2026-10-07', photos: [] },
    ], isLoading: false } as never);
    render(<InventoryRegistrationTab accessPassword="2520" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録しない' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録しない' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '元に戻す' })); });
    expect(restoreImport).toHaveBeenCalledWith('b');
    expect(restoreImport).not.toHaveBeenCalledWith('a');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録しない' })); });
    fireEvent.click(screen.getByRole('button', { name: 'タブ切替' }));
    fireEvent.click(screen.getByRole('button', { name: 'タブ切替' }));
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
  });

  it('clears the dismissal undo when the next candidate is registered', async () => {
    vi.mocked(useInventoryImports).mockReturnValue({ data: [
      { id: 'a', sourceItemId: 10, area: '機械A', createdAt: '2026-10-08', photos: [] },
      { id: 'b', sourceItemId: 9, area: '機械B', createdAt: '2026-10-07', photos: [] },
    ], isLoading: false } as never);
    vi.mocked(useInventoryItems).mockReturnValue({ data: [{ id: 'existing', name: '治具', photos: [], compartments: [], unit: null }], isLoading: false } as never);
    render(<InventoryRegistrationTab accessPassword="2520" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録しない' })); });
    fireEvent.click(screen.getByRole('button', { name: '既存のアイテムに写真を追加' }));
    fireEvent.click(screen.getByRole('button', { name: /治具/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録する' })); });
    expect(registerImport).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
  });

  it('keeps undo available when restoring the dismissed candidate fails', async () => {
    vi.mocked(useInventoryImports).mockReturnValue({ data: [{ id: 'last', sourceItemId: 1, area: '機械', createdAt: '2026-10-08', photos: [] }], isLoading: false } as never);
    restoreImport.mockRejectedValue({ response: { data: { message: '候補を戻せません' } } });
    render(<InventoryRegistrationTab accessPassword="2520" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録しない' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '元に戻す' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('候補を戻せません');
    expect(screen.getByRole('button', { name: '元に戻す' }).parentElement).toContainElement(screen.getByRole('alert'));
  });

  it('keeps B selected and its draft when a pending dismissal of A completes', async () => {
    vi.mocked(useInventoryImports).mockReturnValue({ data: [
      { id: 'a', sourceItemId: 10, area: '機械A', createdAt: '2026-10-08', photos: [] },
      { id: 'b', sourceItemId: 9, area: '機械B', createdAt: '2026-10-07', photos: [] },
    ], isLoading: false } as never);
    let finish!: (value: object) => void;
    dismissImport.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.click(screen.getByRole('button', { name: '登録しない' }));
    fireEvent.click(screen.getByRole('button', { name: '候補 #9' }));
    fireEvent.change(screen.getByLabelText('アイテム名'), { target: { value: 'Bの入力中の名前' } });
    fireEvent.change(screen.getByLabelText('型式'), { target: { value: 'B-12' } });
    await act(async () => { finish({}); });
    expect(screen.getByRole('button', { name: '候補 #9' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('アイテム名')).toHaveValue('Bの入力中の名前');
    expect(screen.getByLabelText('型式')).toHaveValue('B-12');
    expect(screen.queryByRole('button', { name: '候補 #10' })).not.toBeInTheDocument();
  });

  it('removes dismissal undo when B starts editing so its draft cannot be replaced by A', async () => {
    vi.mocked(useInventoryImports).mockReturnValue({ data: [
      { id: 'a', sourceItemId: 10, area: '機械A', createdAt: '2026-10-08', photos: [] },
      { id: 'b', sourceItemId: 9, area: '機械B', createdAt: '2026-10-07', photos: [] },
    ], isLoading: false } as never);
    render(<InventoryRegistrationTab accessPassword="2520" />);
    fireEvent.change(screen.getByLabelText('アイテム名'), { target: { value: 'Aの下書き' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登録しない' })); });
    expect(screen.getByRole('button', { name: '元に戻す' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('アイテム名'), { target: { value: 'Bの下書き' } });
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '候補 #9' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('アイテム名')).toHaveValue('Bの下書き');
  });

});
