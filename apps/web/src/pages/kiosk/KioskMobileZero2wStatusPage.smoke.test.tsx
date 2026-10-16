import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMobilePlacementHaizenCurrent } from '../../api/client';

import { KioskMobileZero2wStatusPage } from './KioskMobileZero2wStatusPage';

import type { HaizenCurrentRowDto } from '../../api/client';

vi.mock('../../api/client', () => ({ getMobilePlacementHaizenCurrent: vi.fn() }));

const rows: HaizenCurrentRowDto[] = [
  { id: 'old', shelfCodeRaw: '西-北-02', manufacturingOrderBarcodeRaw: '0002178005', clientDeviceId: 'device-1',
    distributionNumber: 2, csvDashboardRowId: 'csv-1', productNo: null, fseiban: 'BA1', fhincd: 'P1',
    fhinmei: '脚（左）', updatedAt: '2026-10-16T01:00:00Z', resolutionNote: 'RESOLVED' },
  { id: 'new', shelfCodeRaw: '東-南-01', manufacturingOrderBarcodeRaw: '0002178006', clientDeviceId: 'device-2',
    distributionNumber: null, csvDashboardRowId: null, productNo: null, fseiban: null, fhincd: null,
    fhinmei: null, updatedAt: '2026-10-16T02:00:00Z', resolutionNote: 'UNRESOLVED' }
];

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/kiosk/mobile-placement/zero2w-status']}><Routes>
      <Route path="/kiosk/mobile-placement/zero2w-status" element={<KioskMobileZero2wStatusPage />} />
      <Route path="/kiosk/mobile-placement" element={<div>配膳ハブ</div>} />
    </Routes></MemoryRouter>
  </QueryClientProvider>);
  return { ...view, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMobilePlacementHaizenCurrent).mockResolvedValue({ rows: [] });
});

describe('KioskMobileZero2wStatusPage', () => {
  it('Zero2W 配膳一覧ページを表示する', async () => {
    mount();
    expect(screen.getByRole('button', { name: '戻る' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Zero2W 棚番配膳の状態' })).toBeInTheDocument();
    expect(await screen.findByText('該当する配膳記録はありません。')).toBeInTheDocument();
    expect(getMobilePlacementHaizenCurrent).toHaveBeenCalledWith({ shelfCodeRaw: undefined, limit: 50 });
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.getByText('配膳ハブ')).toBeInTheDocument();
  });

  it('counts and filters using resolutionNote and orders newest first', async () => {
    vi.mocked(getMobilePlacementHaizenCurrent).mockResolvedValue({ rows });
    mount();
    expect(await screen.findByRole('button', { name: 'すべて 2' })).toHaveAttribute('aria-pressed', 'true');
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('東-南-01');
    expect(items[1]).toHaveTextContent('分配2');
    expect(within(items[1]).getByText('日程一致')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '未照合 1' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('listitem')).toHaveTextContent('東-南-01');
    expect(screen.queryByText('脚（左）')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'すべて 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'すべて 2' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('refreshes data and preserves the unmatched filter', async () => {
    vi.mocked(getMobilePlacementHaizenCurrent).mockResolvedValueOnce({ rows }).mockResolvedValue({ rows: [rows[0]] });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '未照合 1' }));
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    expect(await screen.findByRole('button', { name: '未照合 0' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('該当する配膳記録はありません。')).toBeInTheDocument();
    expect(getMobilePlacementHaizenCurrent).toHaveBeenCalledTimes(2);
  });

  it('offers retry for an error', async () => {
    vi.mocked(getMobilePlacementHaizenCurrent).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ rows });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('配膳一覧の取得に失敗しました');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the 15 second polling interval', async () => {
    vi.useFakeTimers();
    const view = mount();
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(getMobilePlacementHaizenCurrent).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
      expect(getMobilePlacementHaizenCurrent).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      view.client.clear();
      vi.useRealTimers();
    }
  });
});
