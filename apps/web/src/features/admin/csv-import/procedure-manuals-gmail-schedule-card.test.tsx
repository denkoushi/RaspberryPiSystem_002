import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcedureMaterialGmailScheduleCard } from './ProcedureMaterialGmailScheduleCard';

const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), ingest: vi.fn() }));
vi.mock('../../../api/backup', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/backup')>(),
  getCsvImportSchedules: mocks.list, updateCsvImportSchedule: mocks.update,
}));
vi.mock('../../../api/client', () => ({ ingestProcedureMaterialsGmail: mocks.ingest }));
const other = { id: 'other', enabled: true, schedule: '0 10 * * *', targets: [{ type: 'csvDashboards', source: 'dashboard' }] };
const materialRow = { id: 'procedure-material-gmail', enabled: false, schedule: '*/5 * * * *', targets: [{ type: 'procedureMaterialGmail', source: '[Procedure-material]' }] };

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['backup-config'], { csvImports: [{ ...other, schedule: '0 1 * * *' }], procedureMaterialGmailIngest: { fromEmail: 'sender@example.com' } });
  queryClient.setQueryData(['backup-config-health'], { status: 'ok' });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(<QueryClientProvider client={queryClient}><ProcedureMaterialGmailScheduleCard /></QueryClientProvider>);
  return { queryClient, invalidate };
}

describe('procedure-manuals Gmail schedule card', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.list.mockResolvedValue({ schedules: [other, materialRow], warnings: [] });
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
    expect(queryClient.getQueryData(['backup-config'])).toEqual({ csvImports: [{ ...other, schedule: '0 1 * * *' }], procedureMaterialGmailIngest: { fromEmail: 'sender@example.com' } });
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
});
