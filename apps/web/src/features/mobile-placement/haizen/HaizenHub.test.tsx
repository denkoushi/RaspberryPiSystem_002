import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postMobilePlacementShelfRegister, putMobilePlacementShelfPhoto, moveOrderPlacementBranch, registerOrderPlacement, verifyMobilePlacementSlipMatch } from '../../../api/client';
import { shelfOfflineQueueStore } from '../shelfMaster/offline/shelfOfflineQueueStore';
import { useMobilePlacementPageState } from '../useMobilePlacementPageState';
import { useOrderPlacementBranches } from '../useOrderPlacementBranches';
import { useRegisteredShelves } from '../useRegisteredShelves';

import { HaizenHub } from './HaizenHub';
import { haizenOfflineQueueStore } from './offline/haizenOfflineQueueStore';

import type { HaizenHubSheet } from './HaizenHub';

const mocks = vi.hoisted(() => ({ branchError: false, branchLoading: false, branchFetching: false, refetch: vi.fn(), branches: [] as { id: string; branchNo: number; shelfCodeRaw: string }[] }));
vi.mock('../../../api/client', () => ({
  postMobilePlacementShelfRegister: vi.fn(), putMobilePlacementShelfPhoto: vi.fn(),
  moveOrderPlacementBranch: vi.fn(), registerOrderPlacement: vi.fn(),
  verifyMobilePlacementSlipMatch: vi.fn(), parseActualSlipImage: vi.fn(), getMobilePlacementShelfPhoto: vi.fn()
}));
vi.mock('../../barcode-scan', () => ({
  KIOSK_STANDARD_BARCODE_SCAN_SESSION: {},
  BarcodeScanModal: ({ open, onSuccess, onAbort, engine }: { open: boolean; onSuccess: (v: string) => void; onAbort: () => void; engine: string }) => open
    ? <div role="dialog" aria-label="scanner"><span>{engine}</span><button onClick={() => onSuccess('SCANNED')}>scan</button><button onClick={onAbort}>abort</button></div> : null
}));
vi.mock('../useRegisteredShelves', () => ({ useRegisteredShelves: () => ({
  data: { shelves: [{ shelfCodeRaw: 'A-03', isStructured: true, machineName: '50013_540AP', direction: '北' }, { shelfCodeRaw: 'A-04', isStructured: true, machineName: '研削', direction: '南' }] },
  isLoading: false, isError: false, refetch: vi.fn()
}) }));
vi.mock('../useOrderPlacementBranches', () => ({ useOrderPlacementBranches: () => ({
  data: mocks.branchLoading ? undefined : { branches: mocks.branches }, isLoading: mocks.branchLoading, isFetching: mocks.branchLoading || mocks.branchFetching, isError: mocks.branchError, refetch: mocks.refetch
}) }));

function Harness() {
  const [sheet, setSheet] = useState<HaizenHubSheet>(null);
  const mp = useMobilePlacementPageState();
  const shelves = useRegisteredShelves();
  const branches = useOrderPlacementBranches(mp.orderBarcode);
  const navigate = useNavigate();
  return <>
    <HaizenHub mp={mp} sheet={sheet} setSheet={setSheet} shelves={shelves} branches={branches} onNavigate={navigate} onShelfMaster={() => navigate('/kiosk/mobile-placement/shelf-master')} onPhoto={() => { mp.setActualOrder(''); mp.setActualFseiban('FS-PHOTO'); }} />
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
async function chooseShelf(branchNo = 1) {
  fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
  if (screen.queryByRole('button', { name: '移動票 製造オーダー番号' })) typePlaceSlip();
  fireEvent.click(screen.getByRole('button', { name: branchNo === 0 ? '分配なし' : `分配${branchNo}`, exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '全部', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: '棚 50013_540AP 北', exact: true }));
}

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.branches = []; mocks.branchError = false; mocks.branchLoading = false; mocks.branchFetching = false;
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  for (const record of await shelfOfflineQueueStore.list()) await shelfOfflineQueueStore.remove(record.id);
  for (const record of await haizenOfflineQueueStore.list()) await haizenOfflineQueueStore.remove(record.clientRecordId);
  vi.mocked(registerOrderPlacement).mockResolvedValue({ branchState: { id: 'b1', branchNo: 1, shelfCodeRaw: 'A-03' }, event: { id: 'event1234' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
  vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValue({ ok: true, reason: 'match', expected: { fseiban: 'FS1', fhincd: 'PART1', partName: 'ブラケット' } });
});

afterEach(() => vi.restoreAllMocks());

describe('Haizen hub', () => {
  it('sends saved shelf registrations when opening the hub', async () => {
    const photo = { contentType: 'image/jpeg' as const, dataBase64: '/9j/' };
    await shelfOfflineQueueStore.put({ id: 'shelf', shelfCodeRaw: '電気室', displayLabel: null, photo,
      createdAt: '2026-10-27T00:00:00Z', stage: 'unregistered', status: 'pending' });
    vi.mocked(postMobilePlacementShelfRegister).mockResolvedValue({ shelf: { shelfCodeRaw: '電気室', isStructured: true } });
    vi.mocked(putMobilePlacementShelfPhoto).mockResolvedValue({ photoUpdatedAt: 'now' });
    mount();
    await waitFor(() => expect(putMobilePlacementShelfPhoto).toHaveBeenCalledWith('電気室', photo));
    expect(postMobilePlacementShelfRegister).toHaveBeenCalledWith({ shelfCodeRaw: '電気室', displayLabel: null });
    await waitFor(async () => expect(await shelfOfflineQueueStore.list()).toEqual([]));
    expect(registerOrderPlacement).not.toHaveBeenCalled();
  });

  it('bottom row has four tabs, purchase navigates, and menu dismisses', () => {
    mount();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    const bottom = screen.getByRole('contentinfo');
    expect(bottom).toContainElement(screen.getByRole('tablist', { name: '作業' }));
    expect(within(bottom).queryByRole('button', { name: '移動票を読む' })).not.toBeInTheDocument();
    expect(screen.getByRole('main').compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const stubs = bottom.previousElementSibling;
    expect(stubs).toContainElement(screen.getByRole('button', { name: '移動票を読む' }));
    expect(stubs).toContainElement(screen.getByRole('button', { name: '現品票を読む' }));
    expect(stubs?.closest('main')).toBeNull();
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
  it('shows shelf photos and a solo bottom nav before a place slip is read', async () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    expect(screen.queryByRole('button', { name: '票を読む' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('contentinfo')).getAllByRole('button')).toHaveLength(1);
    const slipButton = screen.getByRole('button', { name: '移動票 製造オーダー番号' });
    expect(slipButton.closest('main')).toBeNull();
    expect(slipButton.parentElement?.nextElementSibling).toBe(screen.getByRole('contentinfo'));
    const list = within(screen.getByRole('region', { name: '棚の写真' }));
    expect(screen.queryByRole('button', { name: '棚を読む' })).not.toBeInTheDocument();
    expect(screen.queryByText('先に票を読む')).not.toBeInTheDocument();
    expect(list.getByRole('button', { name: '棚 50013_540AP 北', exact: true })).toBeDisabled();
    expect(list.getByRole('button', { name: '大きい画面で選ぶ' })).toBeDisabled();
  });
  it('selects a shelf from the photos on the 配膳 tab and enlarges it on a second tap', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '手入力', exact: true }));
    fireEvent.change(screen.getByLabelText('移動票 製造order'), { target: { value: '0002178005' } });
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    typePlaceSlip();
    fireEvent.click(screen.getByRole('button', { name: '分配1', exact: true }));
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
    vi.mocked(registerOrderPlacement).mockResolvedValue({ branchState: { id: 'b1', branchNo: 1, shelfCodeRaw: 'A-03' }, event: { id: 'event1234' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
    mount();
    typeSlips();
    await waitFor(() => expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledTimes(1));
    expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledWith({ transferOrderBarcodeRaw: '0002178005', actualOrderBarcodeRaw: '4501238876', transferPartBarcodeRaw: '', actualPartBarcodeRaw: '', actualFseibanRaw: '' });
    expect(screen.queryByRole('button', { name: '写真から読む' })).not.toBeInTheDocument();
    await chooseShelf();
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    await waitFor(() => expect(registerOrderPlacement).toHaveBeenCalledWith({ shelfCodeRaw: 'A-03', manufacturingOrderBarcodeRaw: '0002178005', slipKind: 'manufacturing_order', clientRecordId: expect.any(String), placedAt: expect.any(String), branchNo: 1 }, 8000));
    await screen.findByText(/分配1を置きました/);
    expect(screen.getByRole('button', { name: '移動票 製造オーダー番号' })).toBeInTheDocument();
    expect(screen.queryByText('先に票を読む')).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: '現品票を読む' })).toBeInTheDocument();
  });
  it('mismatch retries the actual slip, scanner stays auto-native', async () => {
    vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValue({ ok: false, reason: 'different_seiban', actual: { fseiban: 'FS2' } });
    mount();
    typeSlips();
    await screen.findByRole('status', { name: '不一致' });
    expect(screen.queryByRole('button', { name: '現品票を読み直す' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '現品票を読む' }));
    expect(screen.getByText('auto-native')).toBeInTheDocument();
    fireEvent.click(screen.getByText('scan'));
    await waitFor(() => expect(verifyMobilePlacementSlipMatch).toHaveBeenLastCalledWith(expect.objectContaining({ actualOrderBarcodeRaw: 'SCANNED' })));
    expect(registerOrderPlacement).not.toHaveBeenCalled();
  });
  it('moves a stamp through the same queue and preserves verification inputs', async () => {
    mocks.branches = [{ id: 'branch-2', branchNo: 2, shelfCodeRaw: 'A-04' }];
    vi.mocked(registerOrderPlacement).mockResolvedValue({ action: 'moved', branchState: { branchNo: 2 }, event: { id: 'move' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
    mount(); typeSlips(); await chooseShelf(2);
    fireEvent.click(screen.getByRole('button', { name: 'ここへ移す' }));
    await screen.findByText('分配2を移しました');
    expect(registerOrderPlacement).toHaveBeenCalledWith(expect.objectContaining({ branchNo: 2, shelfCodeRaw: 'A-03', clientRecordId: expect.any(String) }), 8000);
    expect(moveOrderPlacementBranch).not.toHaveBeenCalled();
    expect(await haizenOfflineQueueStore.list()).toEqual([]);
    fireEvent.click(screen.getByRole('tab', { name: '照合' }));
    expect(screen.getByText('0002178005')).toBeInTheDocument();
    expect(screen.getByText('4501238876')).toBeInTheDocument();
  });
  it('queues moves offline with their selected stamp', async () => {
    mocks.branches = [{ id: 'branch-2', branchNo: 2, shelfCodeRaw: 'A-04' }];
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount(); await chooseShelf(2);
    fireEvent.click(screen.getByRole('button', { name: 'ここへ移す' }));
    await screen.findByText('スマホに保存しました（未送信 1件）');
    expect(await haizenOfflineQueueStore.list()).toEqual([expect.objectContaining({ branchNo: 2, shelfCode: 'A-03' })]);
    expect(moveOrderPlacementBranch).not.toHaveBeenCalled();
    expect(registerOrderPlacement).not.toHaveBeenCalled();
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
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
    expect(screen.queryByText('現品票')).not.toBeInTheDocument();
    expect(verifyMobilePlacementSlipMatch).not.toHaveBeenCalled();
    expect(localStorage.getItem('haizen-tab')).toBe('place');
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    await waitFor(() => expect(registerOrderPlacement).toHaveBeenCalledWith({ shelfCodeRaw: 'A-03', manufacturingOrderBarcodeRaw: '0002178005', slipKind: 'manufacturing_order', clientRecordId: expect.any(String), placedAt: expect.any(String), branchNo: 1 }, 8000));
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
    expect(screen.getByText('現品票', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('SCANNED')).toHaveClass('font-mono');
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeDisabled();
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
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    await screen.findByText('スマホに保存しました（未送信 1件）');
    expect(screen.getByText('圏外')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '現品票 注文番号' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '未送信 1' }));
    const sheet = within(screen.getByRole('dialog', { name: '未送信' }));
    expect(sheet.getByText('4501238876')).toBeInTheDocument();
    expect(sheet.getByText(/現品票 · 分配1/)).toBeInTheDocument();
    expect(sheet.queryByRole('button', { name: '消す' })).not.toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(screen.queryByRole('button', { name: '未送信 1' })).not.toBeInTheDocument());
    expect(screen.queryByText('圏外')).not.toBeInTheDocument();
    expect(registerOrderPlacement).toHaveBeenCalledTimes(2);
    expect(vi.mocked(registerOrderPlacement).mock.calls[0]).toEqual(vi.mocked(registerOrderPlacement).mock.calls[1]);
  });
  it('retakes a 404 record with its original kind, stamp and shelf and requires two taps to delete', async () => {
    vi.mocked(registerOrderPlacement).mockRejectedValue({ isAxiosError: true, response: { status: 404, data: { message: 'この注文番号は購買データにありません' } } });
    mount(); typePlaceSlip('po', '4501238876'); await chooseShelf();
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    fireEvent.click(await screen.findByRole('button', { name: '要確認 1' }));
    expect(screen.getByText('この注文番号は購買データにありません')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '読み直す' }));
    await screen.findByRole('dialog', { name: 'scanner' });
    fireEvent.click(screen.getByText('scan'));
    expect(screen.getByText('現品票', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分配1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
    expect(await haizenOfflineQueueStore.list()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    fireEvent.click(await screen.findByRole('button', { name: '要確認 1' }));
    fireEvent.click(screen.getByRole('button', { name: '消す' }));
    expect(await haizenOfflineQueueStore.list()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '本当に消す' }));
    await screen.findByText('記録はありません');
    expect(await haizenOfflineQueueStore.list()).toEqual([]);
  });

  it('shows six compact stamp buttons above the primary action and requires stamp then shelf', async () => {
    mount(); typePlaceSlip();
    const group = screen.getByRole('group', { name: '分配' });
    expect(within(group).getAllByRole('button').map(button => button.textContent)).toEqual(['分配なし', '分配1', '分配2', '分配3', '分配4', '分配5']);
    expect(group.closest('main')).toBeNull();
    expect(group.parentElement?.nextElementSibling).toBe(screen.getByRole('contentinfo'));
    expect(screen.queryByText(/新規/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '分配なし' }));
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '棚 50013_540AP 北' }));
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
    expect(screen.queryByText('A-03')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('A-03');
    fireEvent.click(screen.getByRole('button', { name: '分配3', exact: true }));
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北' })).toHaveAttribute('aria-pressed', 'true');
  });
  it.each(['sent', 'pending', 'needs_check'])('retains the shelf for the next slip after %s and after clearing the slip', async (status) => {
    if (status === 'pending') vi.mocked(registerOrderPlacement).mockRejectedValueOnce(new Error('network'));
    if (status === 'needs_check') vi.mocked(registerOrderPlacement).mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: { message: '分配が競合しています' } } });
    mount(); typePlaceSlip(); await chooseShelf();
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    await screen.findByRole('button', { name: '移動票 製造オーダー番号' });
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北', pressed: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '移動票 製造オーダー番号' }));
    fireEvent.click(screen.getByText('scan'));
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北', pressed: true })).toBeDisabled();
    expect(within(screen.getByRole('group', { name: '分配' })).queryAllByRole('button', { pressed: true })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '分配2', exact: true }));
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '読み直す', exact: true }));
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北', pressed: true })).toBeDisabled();
    typePlaceSlip('mo', 'NEXT');
    expect(within(screen.getByRole('group', { name: '分配' })).queryAllByRole('button', { pressed: true })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '分配1', exact: true }));
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
  });

  it('auto-selects only no-distribution and disables numbered stamps', async () => {
    mocks.branches = [{ id: 'none', branchNo: 0, shelfCodeRaw: 'A-04' }];
    mount(); typePlaceSlip();
    expect(screen.getByRole('button', { name: '分配なし' })).toHaveAttribute('aria-pressed', 'true');
    for (const no of [1, 2, 3, 4, 5]) expect(screen.getByRole('button', { name: `分配${no}`, exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: '前回', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '棚 研削 南' }));
    expect(screen.getByRole('button', { name: '今と同じ棚です' })).toBeDisabled();
    vi.mocked(registerOrderPlacement).mockResolvedValue({ action: 'moved', branchState: { branchNo: 0 }, event: { id: 'move' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
    await chooseShelf(0);
    fireEvent.click(screen.getByRole('button', { name: 'ここへ移す' }));
    await screen.findByText('分配なしを移しました');
    expect(registerOrderPlacement).toHaveBeenCalledWith(expect.objectContaining({ branchNo: 0 }), 8000);
  });
  it('leaves numbered placements unselected, excludes none and filters only the selected previous shelf', () => {
    mocks.branches = [{ id: 'b1', branchNo: 1, shelfCodeRaw: 'A-03' }, { id: 'b2', branchNo: 2, shelfCodeRaw: 'A-04' }];
    mount(); typePlaceSlip();
    expect(screen.getByRole('button', { name: '分配なし' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '分配2', exact: true }));
    expect(screen.getByRole('button', { name: 'ここへ移す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '前回', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '棚 50013_540AP 北' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部', exact: true }));
    expect(within(screen.getByRole('button', { name: '棚 研削 南' })).getByText('前回')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: '棚 50013_540AP 北' })).queryByText('前回')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '分配5', exact: true }));
    expect(screen.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('前回')).not.toBeInTheDocument();
  });
  it('allows any stamp offline when the branch list failed and offers retry', async () => {
    mocks.branchError = true;
    mocks.branches = [{ id: 'none', branchNo: 0, shelfCodeRaw: 'A-04' }];
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount(); typePlaceSlip();
    for (const button of within(screen.getByRole('group', { name: '分配' })).getAllByRole('button')) expect(button).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    await chooseShelf(5);
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    await screen.findByText('スマホに保存しました（未送信 1件）');
    expect(await haizenOfflineQueueStore.list()).toEqual([expect.objectContaining({ branchNo: 5 })]);
  });
  it('waits for the current slip branch query before auto-selecting none', async () => {
    mocks.branchLoading = true;
    const view = mount(); typePlaceSlip();
    expect(screen.getByText('分配一覧を読み込み中…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeDisabled();
    mocks.branchLoading = false; mocks.branches = [{ id: 'none', branchNo: 0, shelfCodeRaw: 'A-04' }];
    // A tab switch rerenders the harness, simulating query completion.
    fireEvent.click(screen.getByRole('tab', { name: '照合' }));
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '分配なし' })).toHaveAttribute('aria-pressed', 'true'));
    view.unmount();
  });

  it('uses the refetched list when the same slip is read immediately after placement', async () => {
    vi.mocked(registerOrderPlacement).mockResolvedValue({ action: 'created', branchState: { branchNo: 0 }, event: { id: 'created' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
    mount(); typePlaceSlip(); await chooseShelf(0);
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    await screen.findByText('分配なしを置きました');
    mocks.branchFetching = true; // Cached empty list remains available with isLoading=false.
    typePlaceSlip();
    expect(screen.getByRole('button', { name: '分配なし' })).toHaveAttribute('aria-pressed', 'false');
    mocks.branches = [{ id: 'none', branchNo: 0, shelfCodeRaw: 'A-03' }];
    mocks.branchFetching = false;
    fireEvent.click(screen.getByRole('button', { name: '手入力', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    expect(screen.getByRole('button', { name: '分配なし' })).toHaveAttribute('aria-pressed', 'true');
    for (const no of [1, 2, 3, 4, 5]) expect(screen.getByRole('button', { name: `分配${no}`, exact: true })).toBeDisabled();
  });

  it('does not use a cached exclusive stamp while refetching', () => {
    mocks.branches = [{ id: 'none', branchNo: 0, shelfCodeRaw: 'A-04' }];
    mocks.branchFetching = true;
    mount(); typePlaceSlip();
    for (const button of within(screen.getByRole('group', { name: '分配' })).getAllByRole('button')) {
      expect(button).toBeEnabled();
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
    mocks.branchFetching = false;
    mocks.branches = [{ id: 'numbered', branchNo: 2, shelfCodeRaw: 'A-04' }];
    fireEvent.click(screen.getByRole('button', { name: '手入力', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    expect(screen.getByRole('button', { name: '分配なし' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeDisabled();
  });

  it.each([[3, 0], [0, 2]])('clears stamp %i but retains its shelf when the loaded list only permits stamp %i', async (selected, current) => {
    mocks.branchLoading = true;
    mount(); typePlaceSlip(); await chooseShelf(selected);
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
    mocks.branchLoading = false;
    mocks.branches = [{ id: 'current', branchNo: current, shelfCodeRaw: 'A-04' }];
    fireEvent.click(screen.getByRole('button', { name: '手入力', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北', pressed: true })).toBeInTheDocument();
    const invalid = screen.getByRole('button', { name: selected === 0 ? '分配なし' : `分配${selected}`, exact: true });
    expect(invalid).toBeDisabled();
    expect(invalid).toHaveAttribute('aria-pressed', 'false');
    if (current === 0) {
      expect(screen.getByRole('button', { name: '分配なし' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'ここへ移す' })).toBeEnabled();
    } else {
      expect(screen.getByRole('button', { name: 'ここに置く' })).toBeDisabled();
    }
  });

  it.each([false, true])('retains the retaken shelf but clears a conflicting stamp (delayed list: %s)', async (delayed) => {
    vi.mocked(registerOrderPlacement).mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { message: '分配が競合しています' } } });
    mount(); typePlaceSlip(); await chooseShelf(3);
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    fireEvent.click(await screen.findByRole('button', { name: '要確認 1' }));
    fireEvent.click(screen.getByRole('button', { name: '読み直す' }));
    await screen.findByRole('dialog', { name: 'scanner' });
    mocks.branchFetching = delayed;
    mocks.branches = [{ id: 'none', branchNo: 0, shelfCodeRaw: 'A-04' }];
    fireEvent.click(screen.getByText('scan'));
    if (delayed) {
      expect(screen.getByRole('button', { name: '分配3', exact: true })).toHaveAttribute('aria-pressed', 'true');
      mocks.branchFetching = false;
    }
    fireEvent.click(screen.getByRole('button', { name: '手入力', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分配3', exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: '分配3', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '分配なし' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ここへ移す' })).toBeEnabled();
  });

});
