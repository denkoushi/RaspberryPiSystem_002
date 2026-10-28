import { packPlacement, packSchedule } from '@raspi-system/slip-match-core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/domains/mobile-placement', () => ({ deleteOrderPlacementBranch: vi.fn() }));
vi.mock('../../features/mobile-placement/connectivity', () => ({ mobileRequest: (request: () => Promise<unknown>) => request() }));
vi.mock('../../features/mobile-placement/sync/networkGate', () => ({ canSyncNow: vi.fn(() => false), useCanSync: () => false }));
vi.mock('../../features/mobile-placement/local-data/mobileLocalDataStore', async (original) => {
  const module = await original<typeof import('../../features/mobile-placement/local-data/mobileLocalDataStore')>();
  return { ...module, mobileLocalDataStore: module.createMobileLocalDataStore('parts-page-test') };
});

import { deleteOrderPlacementBranch } from '../../api/domains/mobile-placement';
import { haizenOfflineQueueStore } from '../../features/mobile-placement/haizen/offline/haizenOfflineQueueStore';
import { haizenOutboxRunner } from '../../features/mobile-placement/haizen/offline/haizenOutboxRunner';
import { mobileLocalDataStore } from '../../features/mobile-placement/local-data/mobileLocalDataStore';
import { placementDeleteOutboxRunner } from '../../features/mobile-placement/part-search/offline/placementDeleteOutboxRunner';
import { placementDeleteQueueStore } from '../../features/mobile-placement/part-search/offline/placementDeleteQueueStore';
import { canSyncNow } from '../../features/mobile-placement/sync/networkGate';

import { MobilePlacementPartSearchPage } from './MobilePlacementPartSearchPage';

const row = { id: 'branch-1', manufacturingOrderBarcodeRaw: '0002178005', branchNo: 2, shelfCodeRaw: '西-北-02',
  updatedAt: '2026-10-28T00:00:00Z', fseiban: 'BA1S2201', fhincd: 'MD00412163', fhinmei: 'テーブル', productNo: '100', machineName: 'DAD3350' };
const placements = { version: 'b1', dataUpdatedAt: row.updatedAt, rows: [packPlacement(row)] };
function Destination() {
  const location = useLocation();
  return <output aria-label="遷移">{useNavigationType()} {location.pathname} {location.state?.openHaizenMenu ? 'メニュー' : ''}</output>;
}
function mount() {
  return render(<MemoryRouter initialEntries={['/search']}><Routes>
    <Route path="/search" element={<MobilePlacementPartSearchPage />} />
    <Route path="*" element={<Destination />} />
  </Routes></MemoryRouter>);
}
const results = () => within(screen.getByRole('region', { name: '検索結果' }));
const deleteRow = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '西-北-02 テーブル' }));
  fireEvent.click(screen.getByRole('button', { name: 'この品物を消す' }));
  fireEvent.click(screen.getByRole('button', { name: '本当に消す' }));
  await waitFor(() => expect(results().queryByText('テーブル')).not.toBeInTheDocument());
};
beforeEach(async () => {
  vi.clearAllMocks(); vi.mocked(canSyncNow).mockReturnValue(false);
  for (const record of await placementDeleteQueueStore.list()) await placementDeleteQueueStore.remove(record.id);
  for (const record of await haizenOfflineQueueStore.list()) await haizenOfflineQueueStore.remove(record.clientRecordId);
  await mobileLocalDataStore.replace({ placements, schedule: { version: 's1', dataUpdatedAt: row.updatedAt, knownFseibans: ['FS2'],
    rows: [packSchedule({ rowId: 's', productNo: '002', fseiban: 'FS2', fhincd: 'MD2', fhinmei: 'パルプ', fsigencd: '', fkojun: 1 })] } });
});
afterEach(() => vi.unstubAllGlobals());

describe('MobilePlacementPartSearchPage local phone flow', () => {
  it.each([['照合', '/kiosk/mobile-placement', 'verify'], ['配膳', '/kiosk/mobile-placement', 'place'],
    ['購買', '/kiosk/purchase-order-lookup', null]])('%s uses replacement navigation', async (tab, path, stored) => {
    mount();
    await screen.findByText('テーブル');
    expect(screen.getByRole('tab', { name: '部品' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: tab }));
    expect(screen.getByLabelText('遷移')).toHaveTextContent(`REPLACE ${path}`);
    if (stored) expect(localStorage.getItem('haizen-tab')).toBe(stored);
  });
  it('opens the hub menu', async () => {
    mount(); await screen.findByText('テーブル');
    fireEvent.click(screen.getByRole('button', { name: 'ほかの画面' }));
    expect(screen.getByLabelText('遷移')).toHaveTextContent('REPLACE /kiosk/mobile-placement メニュー');
  });
  it('searches fake device rows with kana folding and shows the placements offline date', async () => {
    mount(); await screen.findByText('テーブル');
    expect(screen.getByText('圏外 10/28')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '検索文字' }), { target: { value: 'てふる' } });
    expect(results().getByText('テーブル')).toBeInTheDocument();
  });
  it('hides and queues offline deletes, including after snapshot replacement and remount', async () => {
    const view = mount(); await deleteRow();
    expect(await mobileLocalDataStore.listPlacements()).toEqual([]);
    expect(await placementDeleteQueueStore.list()).toEqual([expect.objectContaining({ id: row.id, row, status: 'pending' })]);
    expect(deleteOrderPlacementBranch).not.toHaveBeenCalled();
    await act(() => mobileLocalDataStore.replace({ placements }));
    expect(results().queryByText('テーブル')).not.toBeInTheDocument();
    view.unmount(); mount();
    await act(async () => {});
    expect(results().queryByText('テーブル')).not.toBeInTheDocument();
  });
  it('shows a rejected delete again without remounting', async () => {
    mount(); await deleteRow();
    vi.mocked(canSyncNow).mockReturnValue(true);
    vi.mocked(deleteOrderPlacementBranch).mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
    await act(() => placementDeleteOutboxRunner.flush());
    expect(await screen.findByText('テーブル')).toBeInTheDocument();
    expect((await placementDeleteQueueStore.list())[0].status).toBe('needs_check');
  });
  it('joins pending manufacturing registrations to schedule and cancels them locally', async () => {
    const pending = { clientRecordId: 'queued', slipKind: 'manufacturing_order' as const, number: '002', shelfCode: 'B', scannedAt: row.updatedAt, status: 'pending' as const };
    await haizenOfflineQueueStore.put(pending);
    await haizenOfflineQueueStore.put({ ...pending, clientRecordId: 'purchase', slipKind: 'purchase_order', shelfCode: 'C' });
    await haizenOfflineQueueStore.put({ ...pending, clientRecordId: 'rejected', status: 'needs_check', shelfCode: 'D' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'B パルプ' }));
    expect(results().getByText('002')).toBeInTheDocument();
    expect(results().queryByText('C')).not.toBeInTheDocument();
    expect(results().queryByText('D')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'この品物を消す' }));
    fireEvent.click(screen.getByRole('button', { name: '本当に消す' }));
    await waitFor(() => expect(results().queryByText('パルプ')).not.toBeInTheDocument());
    expect((await haizenOfflineQueueStore.list()).some((record) => record.clientRecordId === 'queued')).toBe(false);
    expect(await placementDeleteQueueStore.list()).toEqual([]);
    await act(async () => {
      await haizenOfflineQueueStore.put({ ...pending, clientRecordId: 'new' });
      await haizenOutboxRunner().refresh();
    });
    expect(await screen.findByRole('button', { name: 'B パルプ' })).toBeInTheDocument();
  });
});
