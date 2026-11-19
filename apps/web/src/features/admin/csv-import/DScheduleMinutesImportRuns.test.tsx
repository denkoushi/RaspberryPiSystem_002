import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DScheduleMinutesImportRuns } from './DScheduleMinutesImportRuns';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../api/client', () => ({ api: { get, post } }));

const path = '/imports/d-schedule-minutes/runs';
const run = { id: 'source-run', filename: '日程会議議事録.xlsx', kind: 'D_COMPANY', hasOriginalFile: true, createdAt: '2026-11-20T00:00:00.000Z' };

function renderHistory(isScheduleRunning = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DScheduleMinutesImportRuns isScheduleRunning={isScheduleRunning} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: { runs: [
    run,
    { ...run, id: 'other-run', filename: '一般.xlsx', kind: 'INTERNAL' },
    { ...run, id: 'missing-file', filename: '旧ファイル.xlsx', hasOriginalFile: false },
  ] } });
  post.mockReset();
});

describe('DScheduleMinutesImportRuns', () => {
  it('reimports the selected file and shows warning counts only on that row', async () => {
    const response = { data: { id: 'new-run', status: 'SUCCESS', warningCounts: { UNKNOWN_STAR: 2, STALE_FILE: 1 } } };
    let finish!: (value: typeof response) => void;
    post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderHistory();

    const row = within(await screen.findByRole('row', { name: /日程会議議事録\.xlsx/ }));
    const other = within(screen.getByRole('row', { name: /一般\.xlsx/ }));
    expect(row.getByText('D社')).toBeInTheDocument();
    expect(other.getByText('一般')).toBeInTheDocument();
    expect(row.getByText('2026/11/20 9:00')).toBeInTheDocument();
    expect(get).toHaveBeenCalledExactlyOnceWith(path);
    expect(within(screen.getByRole('row', { name: /旧ファイル\.xlsx/ })).getByRole('button')).toBeDisabled();

    fireEvent.click(row.getByRole('button', { name: '取り込み直す' }));
    expect(await row.findByRole('button', { name: '実行中' })).toBeDisabled();
    expect(other.getByRole('button')).toBeDisabled();
    expect(post).toHaveBeenCalledExactlyOnceWith(`${path}/${run.id}/reimport`, {}, { timeout: 180_000 });

    get.mockResolvedValueOnce({ data: { runs: [{ ...run, id: 'new-run', filename: '再取り込み後.xlsx' }, { ...run, id: 'other-run', filename: '一般.xlsx', kind: 'INTERNAL' }] } });
    await act(() => finish(response));
    expect(await row.findByRole('status')).toHaveTextContent('成功・警告 3件');
    expect(await screen.findByRole('row', { name: /再取り込み後\.xlsx/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /日程会議議事録\.xlsx/ })).toBeInTheDocument();
    expect(row.getByRole('button', { name: '取り込み直す' })).toBeEnabled();
    expect(other.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the API error on the selected row and allows a retry', async () => {
    post.mockRejectedValue({ isAxiosError: true, response: { status: 404, data: { message: '保存先に元のファイルが見つかりません' } } });
    renderHistory();
    const row = within(await screen.findByRole('row', { name: /日程会議議事録\.xlsx/ }));
    fireEvent.click(row.getByRole('button'));
    expect(await row.findByRole('alert')).toHaveTextContent('保存先に元のファイルが見つかりません');
    expect(row.getByRole('button')).toBeEnabled();
  });

  it('disables reimport while the Gmail schedule is running', async () => {
    renderHistory(true);
    const table = within(await screen.findByRole('table'));
    expect(table.getAllByRole('button')).toHaveLength(3);
    for (const button of table.getAllByRole('button')) expect(button).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
});
