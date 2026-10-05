import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcedureMaterialGmailScheduleCard } from './ProcedureMaterialGmailScheduleCard';

const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), getConfig: vi.fn(), saveConfig: vi.fn(), ingest: vi.fn() }));
vi.mock('../../../api/backup', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/backup')>(),
  getBackupConfig: mocks.getConfig, updateBackupConfig: mocks.saveConfig, getCsvImportSchedules: mocks.list, updateCsvImportSchedule: mocks.update,
}));
vi.mock('../../../api/client', () => ({ ingestProcedureMaterialsGmail: mocks.ingest }));
const other = { id: 'other', enabled: true, schedule: '0 10 * * *', targets: [{ type: 'csvDashboards', source: 'dashboard' }] };
const materialRow = { id: 'procedure-material-gmail', enabled: false, schedule: '*/5 * * * *', targets: [{ type: 'procedureMaterialGmail', source: '[Procedure-material]' }] };

const initialConfig = { storage: { provider: 'local' }, targets: [], csvImports: [{ ...other, schedule: '0 1 * * *' }], procedureMaterialGmailIngest: { enabled: false, subjectTokens: ['[Procedure-material]'], fromEmail: 'sender@example.com', allowedSenderDomains: ['thkintechs.co.jp'] } };
let currentConfig = initialConfig;

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['backup-config'], currentConfig);
  queryClient.setQueryData(['backup-config-health'], { status: 'ok' });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(<QueryClientProvider client={queryClient}><ProcedureMaterialGmailScheduleCard /></QueryClientProvider>);
  return { queryClient, invalidate };
}

describe('procedure-manuals Gmail schedule card', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    currentConfig = structuredClone(initialConfig);
    mocks.getConfig.mockImplementation(async () => currentConfig);
    mocks.saveConfig.mockImplementation(async (config) => { currentConfig = config; return { success: true }; });
    mocks.list.mockResolvedValue({ schedules: [other, materialRow], warnings: [] });
    mocks.update.mockResolvedValue({ schedule: materialRow, warnings: [] });
    mocks.ingest.mockResolvedValue({ saved: 1, duplicate: 0, skipped: 0, retryable: 0 });
  });
  it.each([false, true])('saves only the enabled field when toggling from %s, invalidating schedule and inventory config caches', async (initial) => {
    mocks.list.mockResolvedValue({ schedules: [other, { ...materialRow, enabled: initial }], warnings: [] });
    const { queryClient, invalidate } = renderCard();
    const checkbox = await screen.findByRole('checkbox', { name: '要領書の素材自動取込' });
    expect(checkbox).toHaveProperty('checked', initial);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: '設定を保存' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledExactlyOnceWith('procedure-material-gmail', { enabled: !initial }));
    expect(await screen.findByText(`保存しました（${initial ? '無効' : '有効'}）`)).toBeInTheDocument();
    for (const key of ['csv-import-schedules', 'backup-config', 'backup-config-health']) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
    expect(queryClient.getQueryData(['backup-config'])).toEqual(initialConfig);
  });
  it('does not save until the schedule API has supplied the builtin row', async () => {
    mocks.list.mockResolvedValue({ schedules: [other], warnings: [] });
    renderCard();
    expect(await screen.findByRole('alert')).toHaveTextContent('設定を取得できないため');
    expect(screen.queryByRole('button', { name: '設定を保存' })).not.toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('runs manual ingestion and disables saving when schedules are unavailable', async () => {
    mocks.list.mockRejectedValue(new Error('unavailable')); renderCard();
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: '設定を保存' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '今すぐ取り込む' }));
    expect(await screen.findByText(/取込 1件/)).toBeInTheDocument(); expect(mocks.ingest).toHaveBeenCalledOnce();
  });
  it('normalizes and saves an added domain while preserving current schedules and other settings', async () => {
    const { invalidate } = renderCard();
    const input = await screen.findByRole('textbox', { name: 'ドメインを追加' });
    await waitFor(() => expect(mocks.getConfig).toHaveBeenCalled());
    currentConfig = { ...currentConfig, csvImports: [{ ...other, schedule: '0 2 * * *' }] };
    fireEvent.change(input, { target: { value: '  @EXAMPLE.COM  ' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(await screen.findByText('保存しました')).toBeInTheDocument();
    expect(mocks.saveConfig).toHaveBeenCalledOnce();
    expect(mocks.saveConfig.mock.calls[0]?.[0]).toEqual({
      ...initialConfig, csvImports: [{ ...other, schedule: '0 2 * * *' }],
      procedureMaterialGmailIngest: { ...initialConfig.procedureMaterialGmailIngest, allowedSenderDomains: ['thkintechs.co.jp', 'example.com'] },
    });
    expect(await screen.findByRole('button', { name: 'example.comを削除' })).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(mocks.update).not.toHaveBeenCalled();
    for (const key of ['csv-import-schedules', 'backup-config', 'backup-config-health']) expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
  });
  it('removes one of several domains and saves only the domain change', async () => {
    currentConfig = { ...currentConfig, procedureMaterialGmailIngest: { ...currentConfig.procedureMaterialGmailIngest, allowedSenderDomains: ['thkintechs.co.jp', 'example.com'] } };
    const confirmation = vi.spyOn(window, 'confirm');
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'example.comを削除' }));
    await screen.findByText('保存しました');
    expect(mocks.saveConfig).toHaveBeenCalledOnce();
    expect(mocks.saveConfig.mock.calls[0]?.[0]).toEqual(initialConfig);
    expect(screen.queryByRole('button', { name: 'example.comを削除' })).not.toBeInTheDocument();
    expect(confirmation).not.toHaveBeenCalled();
  });
  it('confirms deleting the last domain, allowing an explicit empty list', async () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderCard();
    const remove = await screen.findByRole('button', { name: 'thkintechs.co.jpを削除' });
    fireEvent.click(remove);
    expect(confirmation).toHaveBeenCalledWith('全ての送信元を拒否します');
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    fireEvent.click(remove);
    await screen.findByText('保存しました');
    expect(mocks.saveConfig).toHaveBeenCalledOnce();
    expect(mocks.saveConfig.mock.calls[0]?.[0]).toEqual({ ...initialConfig, procedureMaterialGmailIngest: { ...initialConfig.procedureMaterialGmailIngest, allowedSenderDomains: [] } });
    expect(screen.queryByRole('button', { name: 'thkintechs.co.jpを削除' })).not.toBeInTheDocument();
    expect(screen.getByText('全ての送信元を拒否します')).toBeInTheDocument();
  });
  it.each(['localhost', 'sender@example.com', 'example..com', '*.example.com'])('rejects malformed input: %s', async (value) => {
    renderCard();
    fireEvent.change(await screen.findByRole('textbox', { name: 'ドメインを追加' }), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ドメインの形式が不正です');
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });
  it('rejects a normalized duplicate', async () => {
    renderCard();
    fireEvent.change(await screen.findByRole('textbox', { name: 'ドメインを追加' }), { target: { value: ' @THKINTECHS.CO.JP ' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('登録済みです');
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });
  it('shows save errors and keeps the domain input for retry', async () => {
    mocks.saveConfig.mockRejectedValue(new Error('保存に失敗しました'));
    renderCard();
    const input = await screen.findByRole('textbox', { name: 'ドメインを追加' });
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存に失敗しました');
    expect(input).toHaveValue('example.com');
    expect(screen.queryByRole('button', { name: 'example.comを削除' })).not.toBeInTheDocument();
  });

});
