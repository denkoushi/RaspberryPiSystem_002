import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useBackupConfig, useBackupConfigMutations, useInventoryMutations } from '../../../api/hooks';

import { ItemInventoryGmailScheduleCard } from './ItemInventoryGmailScheduleCard';

vi.mock('../../../api/hooks', () => ({
  useBackupConfig: vi.fn(),
  useBackupConfigMutations: vi.fn(),
  useInventoryMutations: vi.fn(),
}));

const backupConfig = {
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
    enabled: true,
    subjectTokens: ['[ItemlistRaspi-photo]'],
    fromEmail: 'inventory@example.com',
  },
};

const updateConfig = { mutateAsync: vi.fn(), isPending: false };
const ingest = { mutateAsync: vi.fn(), isPending: false };

function arrange() {
  vi.mocked(useBackupConfig).mockReturnValue({ data: backupConfig, isLoading: false, isError: false } as never);
  updateConfig.mutateAsync.mockReset();
  updateConfig.mutateAsync.mockResolvedValue({ success: true });
  vi.mocked(useBackupConfigMutations).mockReturnValue({ updateConfig } as never);
  ingest.mutateAsync.mockReset();
  ingest.mutateAsync.mockResolvedValue({ processed: 0 });
  vi.mocked(useInventoryMutations).mockReturnValue({ ingest } as never);
}

describe('ItemInventoryGmailScheduleCard', () => {
  it('preserves the inventory Gmail settings and other backup config when saving', async () => {
    arrange();
    render(<ItemInventoryGmailScheduleCard />);

    expect(screen.getByRole('checkbox', { name: '在庫写真メール自動取込' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '在庫写真メール自動取込' }));
    fireEvent.click(screen.getByRole('button', { name: '設定を保存' }));

    await vi.waitFor(() => expect(updateConfig.mutateAsync).toHaveBeenCalledTimes(1));
    const [updatedConfig] = updateConfig.mutateAsync.mock.calls[0];
    expect(updatedConfig.storage).toEqual(backupConfig.storage);
    expect(updatedConfig.targets).toEqual(backupConfig.targets);
    expect(updatedConfig.csvImports).toEqual(backupConfig.csvImports);
    expect(updatedConfig.itemInventoryGmailIngest).toEqual({
      enabled: false,
      subjectTokens: ['[ItemlistRaspi-photo]'],
      fromEmail: 'inventory@example.com',
    });
  });

  it('runs inventory ingest directly from the schedule page control', async () => {
    arrange();
    render(<ItemInventoryGmailScheduleCard />);

    fireEvent.click(screen.getByRole('button', { name: '在庫写真メールを今すぐ確認' }));

    await vi.waitFor(() => expect(ingest.mutateAsync).toHaveBeenCalledWith(undefined));
    await vi.waitFor(() => expect(screen.getByText(/手動確認を実行しました/)).toBeInTheDocument());
    expect(screen.getByText(/CSVスケジュールとは別に/)).toBeInTheDocument();
  });

  it('does not render a save control when the backup config is unavailable', () => {
    arrange();
    vi.mocked(useBackupConfig).mockReturnValue({ data: undefined, isLoading: false, isError: true } as never);
    render(<ItemInventoryGmailScheduleCard />);

    expect(screen.getByText('設定を取得できないため、ON/OFFの保存は無効です。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '設定を保存' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '在庫写真メールを今すぐ確認' })).toBeInTheDocument();
  });
});
