import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import {
  useBackupConfig,
  useBackupConfigMutations,
  useInventoryHistory,
  useInventoryImportMessages,
  useInventoryImports,
  useInventoryItems,
  useInventoryLocations,
  useInventoryMutations,
} from '../../api/hooks';
import { useNfcStream } from '../../hooks/useNfcStream';

import { RaspiInventoryPage } from './RaspiInventoryPage';

import type { BackupConfig } from '../../api/backup';
import type { InventoryImport, InventoryItem, InventoryShelf } from '../../api/client';

vi.mock('../../api/client', () => ({ inventoryThumbnailUrl: (value: string) => value }));
vi.mock('../../api/hooks', () => ({
  useBackupConfig: vi.fn(),
  useBackupConfigMutations: vi.fn(),
  useInventoryHistory: vi.fn(),
  useInventoryImportMessages: vi.fn(),
  useInventoryImports: vi.fn(),
  useInventoryItems: vi.fn(),
  useInventoryLocations: vi.fn(),
  useInventoryMutations: vi.fn(),
}));
vi.mock('../../hooks/useNfcStream', () => ({ useNfcStream: vi.fn() }));

const itemSummary = {
  id: 'item-1',
  itemCode: 'RI-2-TEST',
  name: '治具',
  model: 'M-1',
  usage: '検査',
  category: '治具',
  area: '30007_KSJP-55',
  note: '共有',
  photos: [],
};

const registeredItem: InventoryItem = {
  ...itemSummary,
  compartments: [{
    id: 'compartment-1',
    stockQuantity: 4,
    area: '30007_KSJP-55',
    shelfNumber: 2,
    drawerNumber: 3,
    itemTagUid: 'item-uid',
    item: itemSummary,
  }],
};

const locations: InventoryShelf[] = [
  {
    id: 'shelf-1',
    area: '30007_KSJP-55',
    shelfNumber: 2,
    drawers: [
      { id: 'drawer-1', drawerNumber: 3, shelf: { area: '30007_KSJP-55', shelfNumber: 2 }, compartments: registeredItem.compartments },
      { id: 'drawer-2', drawerNumber: 4, shelf: { area: '30007_KSJP-55', shelfNumber: 2 }, compartments: [] },
    ],
  },
  {
    id: 'shelf-other',
    area: 'other-area',
    shelfNumber: 8,
    drawers: [{ id: 'drawer-other', drawerNumber: 1, shelf: { area: 'other-area', shelfNumber: 8 }, compartments: [] }],
  },
];

const mutations = {
  ingest: { mutateAsync: vi.fn(), isPending: false },
  retryImport: { mutateAsync: vi.fn(), isPending: false },
  registerImport: { mutateAsync: vi.fn(), isPending: false },
  bindCompartment: { mutateAsync: vi.fn(), isPending: false },
  createShelf: { mutateAsync: vi.fn(), isPending: false },
  createDrawer: { mutateAsync: vi.fn(), isPending: false },
  quantityTag: { mutateAsync: vi.fn(), isPending: false },
  restockTag: { mutateAsync: vi.fn(), isPending: false },
  transaction: { mutateAsync: vi.fn(), isPending: false },
  cancel: { mutateAsync: vi.fn(), isPending: false },
  correction: { mutateAsync: vi.fn(), isPending: false },
  move: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  replaceTag: { mutateAsync: vi.fn(), isPending: false },
};

const backupConfig: BackupConfig = {
  storage: { provider: 'gmail', options: { gmail: { clientId: 'client-id' } } },
  targets: [{ kind: 'database', source: 'employees', enabled: true }],
  csvImports: [{
    id: 'csv-import-scaw',
    provider: 'gmail',
    targets: [{ type: 'csvDashboards', source: 'scaw-dashboard' }],
    schedule: '0 10 * * *',
    enabled: true,
    replaceExisting: false,
  }],
  itemInventoryGmailIngest: {
    enabled: false,
    subjectTokens: ['[ItemlistRaspi-photo]'],
    fromEmail: 'inventory@example.com',
  },
};

const backupConfigMutations = {
  updateConfig: { mutateAsync: vi.fn(), isPending: false },
};

function arrange(imports: InventoryImport[] = []) {
  vi.mocked(useNfcStream).mockReturnValue(null);
  vi.mocked(useInventoryImports).mockReturnValue({ data: imports } as never);
  vi.mocked(useInventoryImportMessages).mockReturnValue({ data: [] } as never);
  vi.mocked(useInventoryItems).mockReturnValue({ data: [registeredItem] } as never);
  vi.mocked(useInventoryLocations).mockReturnValue({ data: locations } as never);
  vi.mocked(useInventoryHistory).mockReturnValue({ data: [] } as never);
  vi.mocked(useInventoryMutations).mockReturnValue(mutations as never);
  vi.mocked(useBackupConfig).mockReturnValue({ data: backupConfig, isLoading: false, isError: false } as never);
  backupConfigMutations.updateConfig.mutateAsync.mockReset();
  backupConfigMutations.updateConfig.mutateAsync.mockResolvedValue({ success: true });
  vi.mocked(useBackupConfigMutations).mockReturnValue(backupConfigMutations as never);
}

describe('RaspiInventoryPage response shapes', () => {
  it('renders registered location/NFC data and offers only same-area move options', () => {
    arrange();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<MemoryRouter initialEntries={['/admin/tools/raspi-inventory']}><RaspiInventoryPage /></MemoryRouter>);

      expect(screen.getByText(/30007_KSJP-55 \/ 棚2 \/ 引出し3 \/ NFC item-uid/)).toBeInTheDocument();
      const moveOption = screen.getByRole('option', { name: '棚2 / 引出し4' });
      expect(moveOption).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: '棚8 / 引出し1' })).not.toBeInTheDocument();

      fireEvent.change(moveOption.parentElement, { target: { value: 'drawer-2' } });
      fireEvent.click(screen.getByRole('button', { name: '移動' }));
      expect(mutations.move.mutateAsync).toHaveBeenCalledWith({ id: 'compartment-1', drawerId: 'drawer-2' });
    } finally {
      confirm.mockRestore();
    }
  });

  it('prefills existing-item metadata before photo-only registration', async () => {
    const registerImport = mutations.registerImport.mutateAsync;
    registerImport.mockClear();
    registerImport.mockResolvedValue(undefined);
    arrange([{
      id: 'payload-1',
      sourceItemId: 2,
      area: '30007_KSJP-55',
      category: null,
      note: null,
      manifest: {},
      status: 'PENDING',
      photos: [{ id: 'photo-1', photoIndex: 1, filename: 'photo.jpg', photoUrl: '/photos/photo.jpg', sha256: 'a'.repeat(64) }],
      messages: [],
    }]);

    render(<MemoryRouter initialEntries={['/admin/tools/raspi-inventory']}><RaspiInventoryPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /候補 #2/ }));
    fireEvent.click(screen.getByRole('button', { name: '既存に追加' }));
    fireEvent.change(screen.getByLabelText('追加先アイテム'), { target: { value: registeredItem.id } });

    expect(screen.getByLabelText('アイテム名')).toHaveValue('治具');
    expect(screen.getByLabelText('型式')).toHaveValue('M-1');
    expect(screen.getByLabelText('用途')).toHaveValue('検査');
    fireEvent.click(screen.getByRole('button', { name: '登録を確定' }));
    await vi.waitFor(() => expect(registerImport).toHaveBeenCalledWith({
      id: 'payload-1',
      input: expect.objectContaining({ mode: 'EXISTING_ITEM', itemId: registeredItem.id, name: '治具', model: 'M-1', usage: '検査' }),
    }));
  });

  it('saves only the inventory Gmail enabled flag and preserves its existing settings', async () => {
    arrange();

    render(<MemoryRouter initialEntries={['/admin/tools/raspi-inventory']}><RaspiInventoryPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('checkbox', { name: '在庫写真メール自動取込' }));
    fireEvent.click(screen.getByRole('button', { name: '設定を保存' }));

    await vi.waitFor(() => expect(backupConfigMutations.updateConfig.mutateAsync).toHaveBeenCalledTimes(1));
    const [updatedConfig] = backupConfigMutations.updateConfig.mutateAsync.mock.calls[0];
    expect(updatedConfig.storage).toEqual(backupConfig.storage);
    expect(updatedConfig.targets).toEqual(backupConfig.targets);
    expect(updatedConfig.csvImports).toEqual(backupConfig.csvImports);
    expect(updatedConfig.itemInventoryGmailIngest).toEqual({
      enabled: true,
      subjectTokens: ['[ItemlistRaspi-photo]'],
      fromEmail: 'inventory@example.com',
    });
    await vi.waitFor(() => expect(screen.getByText('保存しました（有効）')).toBeInTheDocument());
  });

  it('does not allow saving when the backup config could not be fetched', () => {
    arrange();
    vi.mocked(useBackupConfig).mockReturnValue({ data: undefined, isLoading: false, isError: true } as never);

    render(<MemoryRouter initialEntries={['/admin/tools/raspi-inventory']}><RaspiInventoryPage /></MemoryRouter>);

    expect(screen.getByText('設定を取得できないため、ON/OFFの保存は無効です。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '設定を保存' })).not.toBeInTheDocument();
    expect(backupConfigMutations.updateConfig.mutateAsync).not.toHaveBeenCalled();
  });
});
