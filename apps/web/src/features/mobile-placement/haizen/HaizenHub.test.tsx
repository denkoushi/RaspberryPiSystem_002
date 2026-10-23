import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { moveOrderPlacementBranch, registerOrderPlacement, verifyMobilePlacementSlipMatch } from '../../../api/client';
import { useMobilePlacementPageState } from '../useMobilePlacementPageState';
import { useOrderPlacementBranches } from '../useOrderPlacementBranches';
import { useRegisteredShelves } from '../useRegisteredShelves';

import { HaizenHub } from './HaizenHub';
import { haizenOfflineQueueStore } from './offline/haizenOfflineQueueStore';

import type { HaizenHubSheet } from './HaizenHub';

const mocks = vi.hoisted(() => ({ branches: [] as { id: string; branchNo: number; shelfCodeRaw: string }[] }));
vi.mock('../../../api/client', () => ({
  moveOrderPlacementBranch: vi.fn(), registerOrderPlacement: vi.fn(),
  verifyMobilePlacementSlipMatch: vi.fn(), parseActualSlipImage: vi.fn(), getMobilePlacementShelfPhoto: vi.fn()
}));
vi.mock('../../barcode-scan', () => ({
  KIOSK_STANDARD_BARCODE_SCAN_SESSION: {},
  BarcodeScanModal: ({ open, onSuccess, onAbort, engine }: { open: boolean; onSuccess: (v: string) => void; onAbort: () => void; engine: string }) => open
    ? <div role="dialog" aria-label="scanner"><span>{engine}</span><button onClick={() => onSuccess('SCANNED')}>scan</button><button onClick={onAbort}>abort</button></div> : null
}));
vi.mock('../useRegisteredShelves', () => ({ useRegisteredShelves: () => ({
  data: { shelves: [{ shelfCodeRaw: '50013_540AP 北', isStructured: true, machineName: '50013_540AP', direction: '北' }] },
  isLoading: false, isError: false, refetch: vi.fn()
}) }));
vi.mock('../useOrderPlacementBranches', () => ({ useOrderPlacementBranches: () => ({
  data: { branches: mocks.branches }, isLoading: false, isError: false, refetch: vi.fn()
}) }));

function Harness() {
  const [sheet, setSheet] = useState<HaizenHubSheet>(null);
  const mp = useMobilePlacementPageState();
  const shelves = useRegisteredShelves();
  const branches = useOrderPlacementBranches(mp.orderBarcode);
  const navigate = useNavigate();
  return <>
    <HaizenHub mp={mp} sheet={sheet} setSheet={setSheet} shelves={shelves} branches={branches} suggestedNextBranchNo={Math.max(0, ...mocks.branches.map((b) => b.branchNo)) + 1} onNavigate={navigate} onShelfMaster={() => navigate('/kiosk/mobile-placement/shelf-master')} onPhoto={() => { mp.setActualOrder(''); mp.setActualFseiban('FS-PHOTO'); }} />
  </>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/kiosk/mobile-placement']}><Routes>
    <Route path="/kiosk/mobile-placement" element={<Harness />} />
    <Route path="*" element={<div>sub-screen</div>} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
function typeSlips() {
  fireEvent.click(screen.getByRole('button', { name: '手入力', exact: true }));
  fireEvent.change(screen.getByLabelText('移動票 製造order'), { target: { value: '0002178005' } });
  fireEvent.change(screen.getByLabelText('現品票 注文番号 / 製造order'), { target: { value: '4501238876' } });
  fireEvent.click(screen.getByRole('button', { name: '完了' }));
}
function typePlaceSlip(kind: 'mo' | 'po' = 'mo', number = '0002178005') {
  fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
  fireEvent.click(screen.getByRole('button', { name: '手入力', exact: true }));
  fireEvent.change(screen.getByLabelText(kind === 'mo' ? '移動票 製造order' : '現品票 注文番号'), { target: { value: number } });
  fireEvent.click(screen.getByRole('button', { name: '完了' }));
}
async function chooseShelf() {
  fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
  if (screen.queryByRole('button', { name: '票を読む' })) typePlaceSlip();
  fireEvent.click(await screen.findByRole('button', { name: '棚の写真を選ぶ' }));
  const picker = within(screen.getByRole('dialog', { name: '棚を選ぶ' }));
  fireEvent.click(picker.getByRole('button', { name: '50013_540AP', exact: true }));
  fireEvent.click(picker.getByRole('button', { name: '棚 50013_540AP 北', exact: true }));
}

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.branches = [];
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  for (const record of await haizenOfflineQueueStore.list()) await haizenOfflineQueueStore.remove(record.clientRecordId);
  vi.mocked(registerOrderPlacement).mockResolvedValue({ branchState: { id: 'b1', branchNo: 1, shelfCodeRaw: '50013_540AP 北' }, event: { id: 'event1234' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
  vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValue({ ok: true, reason: 'match', expected: { fseiban: 'FS1', fhincd: 'PART1', partName: 'ブラケット' } });
});

afterEach(() => vi.restoreAllMocks());

describe('Haizen hub', () => {
  it('top row has four tabs, purchase navigates, and menu dismisses', () => {
    mount();
    expect(within(screen.getByRole('tablist', { name: '作業' })).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['照合', '配膳', '購買', '部品']);
    fireEvent.click(screen.getByRole('button', { name: 'ほかの画面' }));
    expect(within(screen.getByRole('dialog')).getAllByRole('button')).toHaveLength(3);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ほかの画面' }));
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '購買' }));
    expect(screen.getByText('sub-screen')).toBeInTheDocument();
  });
  it('shows shelf photos directly under the 移動票 and enables them after it is read', async () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    const list = within(screen.getByRole('region', { name: '棚の写真' }));
    expect(screen.queryByRole('button', { name: '棚を読む' })).not.toBeInTheDocument();
    expect(screen.getByText('先に票を読む')).toBeInTheDocument();
    fireEvent.click(list.getByRole('button', { name: '50013_540AP', exact: true }));
    expect(await list.findByRole('button', { name: '棚 50013_540AP 北', exact: true })).toBeDisabled();
    fireEvent.click(list.getByRole('button', { name: '大きい画面で選ぶ' }));
    expect(screen.getByRole('dialog', { name: '棚を選ぶ' })).toBeInTheDocument();
  });
  it('selects a shelf from the photos on the 配膳 tab and enlarges it on a second tap', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '手入力', exact: true }));
    fireEvent.change(screen.getByLabelText('移動票 製造order'), { target: { value: '0002178005' } });
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    typePlaceSlip();
    const list = within(screen.getByRole('region', { name: '棚の写真' }));
    expect(screen.queryByText('先に票を読む')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '部品' })).toBeInTheDocument();
    fireEvent.click(list.getByRole('button', { name: '50013_540AP', exact: true }));
    fireEvent.click(await list.findByRole('button', { name: '棚 50013_540AP 北', exact: true }));
    expect(list.getByRole('button', { name: '棚 50013_540AP 北', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(list.getByRole('button', { name: '棚 50013_540AP 北', exact: true }));
    expect(screen.getByRole('dialog', { name: '棚の写真を拡大' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '閉じる', exact: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(list.getByRole('button', { name: '棚 50013_540AP 北', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
  it('auto verifies and registers an independent place slip, preserving verification inputs', async () => {
    vi.mocked(registerOrderPlacement).mockResolvedValue({ branchState: { id: 'b1', branchNo: 1, shelfCodeRaw: '50013_540AP 北' }, event: { id: 'event1234' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
    mount();
    typeSlips();
    await waitFor(() => expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledTimes(1));
    expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledWith({ transferOrderBarcodeRaw: '0002178005', actualOrderBarcodeRaw: '4501238876', transferPartBarcodeRaw: '', actualPartBarcodeRaw: '', actualFseibanRaw: '' });
    expect(screen.queryByRole('button', { name: '写真から読む' })).not.toBeInTheDocument();
    await chooseShelf();
    fireEvent.click(screen.getByRole('button', { name: '50013_540AP 北 に置く' }));
    await waitFor(() => expect(registerOrderPlacement).toHaveBeenCalledWith({ shelfCodeRaw: '50013_540AP 北', manufacturingOrderBarcodeRaw: '0002178005', slipKind: 'manufacturing_order', clientRecordId: expect.any(String), placedAt: expect.any(String) }, 8000));
    await screen.findByText(/分配1を登録/);
    expect(screen.getByRole('button', { name: '移動票 製造オーダー番号' })).toBeInTheDocument();
    expect(screen.getByText('先に票を読む')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '照合' }));
    expect(screen.getByText('0002178005')).toBeInTheDocument();
    expect(screen.getByText('4501238876')).toBeInTheDocument();
  });
  it('notes when the 現品票 material code was matched by part name', async () => {
    vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValue({ ok: true, reason: 'match', matchedBy: 'part_name',
      expected: { fseiban: 'FS1', fhincd: 'PART1', partName: 'ブラケット' }, actual: { fseiban: 'FS1', partCode: 'MAT9' } });
    mount();
    typeSlips();
    await screen.findByRole('status', { name: '一致' });
    expect(screen.getByText(/を品名で照合/)).toHaveTextContent('素材 MAT9 を品名で照合');
  });
  it('keeps supplementary inputs in verification and rechecks changes', async () => {
    mount();
    typeSlips();
    await screen.findByRole('status', { name: '一致' });
    fireEvent.click(screen.getByRole('button', { name: '手入力', exact: true }));
    fireEvent.change(screen.getByLabelText('移動票 部品番号'), { target: { value: 'P1' } });
    fireEvent.change(screen.getByLabelText('現品票 部品番号'), { target: { value: 'P2' } });
    fireEvent.change(screen.getByLabelText('現品票 製番'), { target: { value: 'F1' } });
    await waitFor(() => expect(verifyMobilePlacementSlipMatch).toHaveBeenLastCalledWith(expect.objectContaining({ transferPartBarcodeRaw: 'P1', actualPartBarcodeRaw: 'P2', actualFseibanRaw: 'F1' })));
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    fireEvent.click(screen.getByRole('button', { name: '現品票をクリア' }));
    expect(screen.queryByRole('status', { name: '一致' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '現品票を読む' })).toHaveLength(2);
  });
  it('mismatch retries the actual slip, scanner stays auto-native', async () => {
    vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValue({ ok: false, reason: 'different_seiban', actual: { fseiban: 'FS2' } });
    mount();
    typeSlips();
    fireEvent.click(await screen.findByRole('button', { name: '現品票を読み直す' }));
    expect(screen.getByText('auto-native')).toBeInTheDocument();
    fireEvent.click(screen.getByText('scan'));
    await waitFor(() => expect(verifyMobilePlacementSlipMatch).toHaveBeenLastCalledWith(expect.objectContaining({ actualOrderBarcodeRaw: 'SCANNED' })));
    expect(registerOrderPlacement).not.toHaveBeenCalled();
  });
  it('moves an existing branch; errors retain the inputs', async () => {
    mocks.branches = [{ id: 'branch-2', branchNo: 2, shelfCodeRaw: '東-南-05' }];
    vi.mocked(moveOrderPlacementBranch).mockRejectedValue(new Error('移動できません'));
    mount();
    typeSlips();
    await chooseShelf();
    expect(screen.getByRole('button', { name: '新規 分配3' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '分配2 東-南-05' }));
    fireEvent.click(screen.getByRole('button', { name: '50013_540AP 北 に置く' }));
    await screen.findByText('移動できません');
    expect(moveOrderPlacementBranch).toHaveBeenCalledWith({ branchStateId: 'branch-2', shelfCodeRaw: '50013_540AP 北' });
    expect(screen.getByText('0002178005')).toBeInTheDocument();
    expect(registerOrderPlacement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '新規 分配3' }));
    fireEvent.click(screen.getByRole('button', { name: '50013_540AP 北 に置く' }));
    await screen.findByText(/分配1を登録/);
    expect(screen.queryByText('移動できません')).not.toBeInTheDocument();
  });
  it('keeps moves on the online path and resets the place slip after success', async () => {
    mocks.branches = [{ id: 'branch-2', branchNo: 2, shelfCodeRaw: '東-南-05' }];
    vi.mocked(moveOrderPlacementBranch).mockResolvedValue({ branchState: { branchNo: 2, shelfCodeRaw: '50013_540AP 北' } } as Awaited<ReturnType<typeof moveOrderPlacementBranch>>);
    mount(); typeSlips(); typePlaceSlip(); await chooseShelf();
    fireEvent.click(screen.getByRole('button', { name: '分配2 東-南-05' }));
    fireEvent.click(screen.getByRole('button', { name: '50013_540AP 北 に置く' }));
    await screen.findByText('分配2を 50013_540AP 北 へ移動しました');
    expect(screen.getByRole('button', { name: '移動票 製造オーダー番号' })).toBeInTheDocument();
    expect(await haizenOfflineQueueStore.list()).toEqual([]);
    expect(registerOrderPlacement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: '照合' }));
    expect(screen.getByText('0002178005')).toBeInTheDocument();
    expect(screen.getByText('4501238876')).toBeInTheDocument();
  });
  it('serializes changed slips while a verification request is pending', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof verifyMobilePlacementSlipMatch>>) => void;
    vi.mocked(verifyMobilePlacementSlipMatch).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    mount();
    typeSlips();
    await waitFor(() => expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '手入力', exact: true }));
    fireEvent.change(screen.getByLabelText('現品票 注文番号 / 製造order'), { target: { value: 'NEW' } });
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    expect(screen.getByRole('button', { name: '照合中…' })).toBeDisabled();
    expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ ok: false, reason: 'different_part' }); });
    await screen.findByRole('status', { name: '一致' });
    expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledTimes(2);
    expect(verifyMobilePlacementSlipMatch).toHaveBeenLastCalledWith(expect.objectContaining({ actualOrderBarcodeRaw: 'NEW' }));
  });
  it('defaults to verification, displays match details and clears both for the next pair', async () => {
    mount();
    expect(screen.getByRole('tab', { name: '照合' })).toHaveAttribute('aria-selected', 'true');
    typeSlips();
    await screen.findByRole('status', { name: '一致' });
    expect(screen.getByText('FS1')).toBeInTheDocument();
    expect(screen.getByText('PART1')).toBeInTheDocument();
    expect(screen.getByText('ブラケット')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次を照合' }));
    expect(screen.queryByText('0002178005')).not.toBeInTheDocument();
    expect(screen.queryByText('4501238876')).not.toBeInTheDocument();
    expect(registerOrderPlacement).not.toHaveBeenCalled();
  });
  it.each([
    ['different_seiban', '不一致', 'この注文は別の製番(FS2)の材料です'],
    ['different_part', '不一致', '部品が違います'],
    ['order_not_found', '未登録', 'この注文番号はまだ届いていません'],
    ['transfer_not_found', '未登録', 'この製造orderが見つかりません']
  ] as const)('renders %s', async (reason, title, message) => {
    vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValue({ ok: false, reason, actual: { fseiban: 'FS2' } });
    mount(); typeSlips();
    await screen.findByRole('status', { name: title });
    expect(screen.getByText(message)).toBeInTheDocument();
    if (title === '未登録') {
      expect(screen.getByRole('button', { name: '写真で製番' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '部品番号' }));
      expect(screen.getByLabelText('現品票 部品番号')).toBeInTheDocument();
    }
  });
  it('rechecks a photo fseiban fallback after an unknown order', async () => {
    vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValueOnce({ ok: false, reason: 'order_not_found' });
    mount(); typeSlips();
    fireEvent.click(await screen.findByRole('button', { name: '写真で製番' }));
    await screen.findByRole('status', { name: '一致' });
    expect(verifyMobilePlacementSlipMatch).toHaveBeenLastCalledWith(expect.objectContaining({ actualOrderBarcodeRaw: '', actualFseibanRaw: 'FS-PHOTO' }));
  });
  it('transport/400 failures are errors, with a serialized retry', async () => {
    vi.mocked(verifyMobilePlacementSlipMatch).mockRejectedValueOnce(new Error('400'));
    mount(); typeSlips();
    await screen.findByText('照合できませんでした');
    expect(screen.queryByText('不一致')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    await screen.findByRole('status', { name: '一致' });
    expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledTimes(2);
  });
  it('registers with only transfer and shelf, and persists the tab', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '手入力', exact: true }));
    fireEvent.change(screen.getByLabelText('移動票 製造order'), { target: { value: '0002178005' } });
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    await chooseShelf();
    expect(screen.getByRole('button', { name: '50013_540AP 北 に置く' })).toBeEnabled();
    expect(screen.queryByText('現品票')).not.toBeInTheDocument();
    expect(verifyMobilePlacementSlipMatch).not.toHaveBeenCalled();
    expect(localStorage.getItem('haizen-tab')).toBe('place');
    fireEvent.click(screen.getByRole('button', { name: '50013_540AP 北 に置く' }));
    await waitFor(() => expect(registerOrderPlacement).toHaveBeenCalledWith({ shelfCodeRaw: '50013_540AP 北', manufacturingOrderBarcodeRaw: '0002178005', slipKind: 'manufacturing_order', clientRecordId: expect.any(String), placedAt: expect.any(String) }, 8000));
  });
  it('restores the last tab', () => {
    localStorage.setItem('haizen-tab', 'place');
    mount();
    expect(screen.getByRole('tab', { name: '配膳' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '照合' }));
    expect(localStorage.getItem('haizen-tab')).toBe('verify');
  });

  it('has two equal slip buttons without icons and scans a PO independently of verification', async () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    const mo = screen.getByRole('button', { name: '移動票 製造オーダー番号' });
    const po = screen.getByRole('button', { name: '現品票 注文番号' });
    expect(mo.parentElement).toBe(po.parentElement);
    expect(po.parentElement).toHaveClass('grid-cols-2');
    expect(mo.querySelector('svg')).toBeNull();
    expect(po.querySelector('svg')).toBeNull();
    fireEvent.click(po);
    fireEvent.click(screen.getByText('scan'));
    expect(screen.getByText('現品票 注文番号')).toBeInTheDocument();
    expect(screen.getByText('SCANNED')).toHaveClass('font-mono');
    expect(screen.getByRole('button', { name: '棚の写真を選ぶ' })).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: '照合' }));
    expect(screen.queryByText('SCANNED')).not.toBeInTheDocument();
    expect(verifyMobilePlacementSlipMatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    expect(screen.getByText('SCANNED')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '読み直す' }));
    expect(screen.queryByText('SCANNED')).not.toBeInTheDocument();
  });
  it('shows pending status and sheet after a network error, and clears on reconnection', async () => {
    vi.mocked(registerOrderPlacement).mockRejectedValueOnce(new Error('network'));
    mount(); typePlaceSlip('po', '4501238876'); await chooseShelf();
    fireEvent.click(screen.getByRole('button', { name: '50013_540AP 北 に置く' }));
    await screen.findByText('スマホに保存しました（未送信 1件）');
    expect(screen.getByText('圏外')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '現品票 注文番号' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '未送信 1' }));
    const sheet = within(screen.getByRole('dialog', { name: '未送信' }));
    expect(sheet.getByText('4501238876')).toBeInTheDocument();
    expect(sheet.getByText(/現品票 · 50013_540AP 北/)).toBeInTheDocument();
    expect(sheet.queryByRole('button', { name: '消す' })).not.toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(screen.queryByRole('button', { name: '未送信 1' })).not.toBeInTheDocument());
    expect(screen.queryByText('圏外')).not.toBeInTheDocument();
    expect(registerOrderPlacement).toHaveBeenCalledTimes(2);
    expect(vi.mocked(registerOrderPlacement).mock.calls[0]).toEqual(vi.mocked(registerOrderPlacement).mock.calls[1]);
  });
  it('retakes a 404 record with its original kind and shelf and requires two taps to delete', async () => {
    vi.mocked(registerOrderPlacement).mockRejectedValue({ isAxiosError: true, response: { status: 404, data: { message: 'この注文番号は購買データにありません' } } });
    mount(); typePlaceSlip('po', '4501238876'); await chooseShelf();
    fireEvent.click(screen.getByRole('button', { name: '50013_540AP 北 に置く' }));
    fireEvent.click(await screen.findByRole('button', { name: '要確認 1' }));
    expect(screen.getByText('この注文番号は購買データにありません')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '読み直す' }));
    await screen.findByRole('dialog', { name: 'scanner' });
    fireEvent.click(screen.getByText('scan'));
    expect(screen.getByText('現品票 注文番号')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '50013_540AP 北 に置く' })).toBeEnabled();
    expect(await haizenOfflineQueueStore.list()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '50013_540AP 北 に置く' }));
    fireEvent.click(await screen.findByRole('button', { name: '要確認 1' }));
    fireEvent.click(screen.getByRole('button', { name: '消す' }));
    expect(await haizenOfflineQueueStore.list()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '本当に消す' }));
    await screen.findByText('記録はありません');
    expect(await haizenOfflineQueueStore.list()).toEqual([]);
  });

});
