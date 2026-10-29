import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOrderPlacementBranches, getMobilePlacementShelfMachines, moveOrderPlacementBranch, registerOrderPlacement, verifyMobilePlacementSlipMatch } from '../../../api/client';
import { api } from '../../../api/http';
import { resetMobileConnectivityForTests, mobileRequest, MOBILE_REQUEST_TIMEOUT_MS, canUseMobileNetwork } from '../connectivity';
import { mobileLocalDataStore } from '../local-data/mobileLocalDataStore';
import { saveOrderBranches } from '../orderPlacementBranchesCache';
import { saveScanFrame } from '../scan-frames/saveScanFrame';
import { shelfOfflineQueueStore } from '../shelfMaster/offline/shelfOfflineQueueStore';
import { MobileSyncProvider } from '../sync/MobileSyncProvider';
import { resetSyncSchedulerForTests } from '../sync/syncScheduler';
import { useMobilePlacementPageState } from '../useMobilePlacementPageState';
import { useOrderPlacementBranches } from '../useOrderPlacementBranches';
import { useRegisteredShelves } from '../useRegisteredShelves';
import { verifyRecordStore } from '../verify-records/verifyRecordStore';

import { HaizenHub } from './HaizenHub';
import { haizenOfflineQueueStore } from './offline/haizenOfflineQueueStore';

import type { HaizenHubSheet } from './HaizenHub';
import type { ScanFrameCapture } from '../../barcode-scan/scanFrameCapture';

vi.mock('../../../api/http', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

const mocks = vi.hoisted(() => ({ scanValue: 'SCANNED', realBranches: false, branchError: false, branchLoading: false, branchFetching: false, refetch: vi.fn(), branches: [] as { id: string; branchNo: number; shelfCodeRaw: string }[] }));
vi.mock('../local-data/mobileLocalDataSync', () => ({ syncMobileLocalData: vi.fn() }));
vi.mock('../../../api/client', () => ({
  getOrderPlacementBranches: vi.fn(), getMobilePlacementShelfMachines: vi.fn(),
  moveOrderPlacementBranch: vi.fn(), registerOrderPlacement: vi.fn(),
  verifyMobilePlacementSlipMatch: vi.fn(), parseActualSlipImage: vi.fn(), getMobilePlacementShelfPhoto: vi.fn()
}));
vi.mock('../scan-frames/saveScanFrame', () => ({ saveScanFrame: vi.fn(() => 'frame-id'), onScanIdle: vi.fn() }));
vi.mock('../../barcode-scan', () => ({
  KIOSK_STANDARD_BARCODE_SCAN_SESSION: {},
  BarcodeScanModal: ({ open, onSuccess, onAbort, engine, onFrameCaptured }: { onFrameCaptured?: (capture: ScanFrameCapture) => void; open: boolean; onSuccess: (v: string) => void; onAbort: () => void; engine: string }) => open
    ? <div role="dialog" aria-label="scanner"><span>{engine}</span><button onClick={() => { onFrameCaptured?.({ outcome: 'decoded', decodedValue: mocks.scanValue, decodeMs: 1500, retryCount: 0, engine: 'native', camera: {}, cropBox: null, capturedAt: new Date().toISOString(), fullCanvas: document.createElement('canvas') }); onSuccess(mocks.scanValue); }}>scan</button><button onClick={onAbort}>abort</button><button onClick={() => { onFrameCaptured?.({ outcome: 'timeout', decodedValue: null, decodeMs: 30000, retryCount: 0, engine: 'native', camera: {}, cropBox: null, capturedAt: new Date().toISOString(), fullCanvas: document.createElement('canvas') }); onAbort(); }}>timeout</button></div> : null
}));
vi.mock('../useRegisteredShelves', () => ({ useRegisteredShelves: () => ({
  data: { shelves: [{ shelfCodeRaw: 'A-03', isStructured: true, machineName: '50013_540AP', direction: '北' }, { shelfCodeRaw: 'A-04', isStructured: true, machineName: '研削', direction: '南' }] },
  isLoading: false, isError: false, refetch: vi.fn()
}) }));
vi.mock('../useOrderPlacementBranches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../useOrderPlacementBranches')>();
  return { useOrderPlacementBranches: (key: string) => mocks.realBranches ? actual.useOrderPlacementBranches(key) : ({
    data: mocks.branchLoading ? undefined : { branches: mocks.branches },
    branchStatus: mocks.branchError ? 'unknown' : mocks.branchLoading ? 'loading' : 'known',
    isLoading: mocks.branchLoading, isFetching: mocks.branchLoading || mocks.branchFetching, isError: mocks.branchError, refetch: mocks.refetch
  }) };
});

function Harness() {
  const [sheet, setSheet] = useState<HaizenHubSheet>(null);
  const mp = useMobilePlacementPageState();
  const shelves = useRegisteredShelves();
  const branches = useOrderPlacementBranches(mp.orderBarcode);
  const navigate = useNavigate();
  return <>
    <button onClick={() => setSheet('inputs')}>open inputs</button>
    <HaizenHub mp={mp} sheet={sheet} setSheet={setSheet} shelves={shelves} branches={branches} onNavigate={navigate} onShelfMaster={() => navigate('/kiosk/mobile-placement/shelf-master')} onPhoto={() => { mp.setActualOrder(''); mp.setActualFseiban('FS-PHOTO'); }} />
  </>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MobileSyncProvider><MemoryRouter initialEntries={['/kiosk/mobile-placement']}><Routes>
    <Route path="/kiosk/mobile-placement" element={<Harness />} />
    <Route path="*" element={<div>sub-screen</div>} />
  </Routes></MemoryRouter></MobileSyncProvider></QueryClientProvider>);
}
function typeSlips() {
  fireEvent.click(screen.getByRole('button', { name: 'open inputs', exact: true }));
  fireEvent.change(screen.getByLabelText('移動票 製造order'), { target: { value: '0002178005' } });
  fireEvent.change(screen.getByLabelText('現品票 注文番号 / 製造order'), { target: { value: '4501238876' } });
  fireEvent.click(screen.getByRole('button', { name: '完了' }));
}
function typePlaceSlip(kind: 'mo' | 'po' = 'mo', number = '0002178005') {
  fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
  fireEvent.click(screen.getByRole('button', { name: 'open inputs', exact: true }));
  fireEvent.change(screen.getByLabelText(kind === 'mo' ? '移動票 製造order' : '現品票 注文番号'), { target: { value: number } });
  fireEvent.click(screen.getByRole('button', { name: '完了' }));
}
async function chooseShelf(branchNo = 1) {
  fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
  if (!screen.queryByRole('group', { name: '分配' })) typePlaceSlip();
  fireEvent.click(screen.getByRole('button', { name: branchNo === 0 ? '分配なし' : `分配${branchNo}`, exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: '棚 50013_540AP 北', exact: true }));
}

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.scanValue = 'SCANNED';
  mocks.realBranches = false; mocks.branches = []; mocks.branchError = false; mocks.branchLoading = false; mocks.branchFetching = false;
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  vi.mocked(getMobilePlacementShelfMachines).mockResolvedValue({ machines: ['50013_540AP'], landmarks: ['電気室'] });
  for (const record of await verifyRecordStore.list()) await verifyRecordStore.remove(record);
  for (const record of await shelfOfflineQueueStore.list()) await shelfOfflineQueueStore.remove(record.id);
  for (const record of await haizenOfflineQueueStore.list()) await haizenOfflineQueueStore.remove(record.clientRecordId);
  vi.mocked(registerOrderPlacement).mockResolvedValue({ branchState: { id: 'b1', branchNo: 1, shelfCodeRaw: 'A-03' }, event: { id: 'event1234' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
  vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValue({ ok: true, reason: 'match', expected: { fseiban: 'FS1', fhincd: 'PART1', partName: 'ブラケット' } });
});

afterEach(() => { resetSyncSchedulerForTests(); resetMobileConnectivityForTests(); vi.restoreAllMocks(); });

describe('Haizen hub', () => {
  it('saves landmarks when opening the hub without visiting shelf master', async () => {
    mount();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('mobile-placement-shelf-machines-v1')!)).toEqual({
      machines: ['50013_540AP'], landmarks: ['電気室']
    }));
  });

  it.each(['offline', 'unreachable', 'online'] as const)('enables put after scanning and selecting a shelf (%s)', async (state) => {
    mocks.realBranches = true;
    vi.mocked(getOrderPlacementBranches).mockResolvedValue({ branches: [] });
    if (state === 'offline') vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    if (state === 'unreachable') await mobileRequest(() => Promise.reject(new Error('network'))).catch(() => {});
    mount();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    fireEvent.click(screen.getByRole('button', { name: '移動票を読む' }));
    fireEvent.click(screen.getByText('scan'));
    for (const button of within(screen.getByRole('group', { name: '分配' })).getAllByRole('button')) expect(button).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '分配なし' }));
    fireEvent.click(screen.getByRole('button', { name: '棚 50013_540AP 北' }));
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
    if (state !== 'online') {
      expect(screen.queryByText('分配一覧を読み込み中…')).not.toBeInTheDocument();
      expect(getOrderPlacementBranches).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
      await screen.findByText('スマホに保存しました（未送信 1件）');
      expect(registerOrderPlacement).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(getOrderPlacementBranches).toHaveBeenCalledOnce());
      await waitFor(() => expect(localStorage.getItem('mobile-placement-order-branches-v1:SCANNED')).toBe(JSON.stringify({ branches: [] })));
    }
  });

  it('bounds a stalled first read and does not wait or send on the second read', async () => {
    mocks.realBranches = true;
    vi.useFakeTimers();
    vi.mocked(getOrderPlacementBranches).mockReturnValue(new Promise(() => {}));
    mount(); typePlaceSlip();
    await act(async () => { await vi.advanceTimersByTimeAsync(MOBILE_REQUEST_TIMEOUT_MS + 1); });
    expect(canUseMobileNetwork()).toBe(false);
    expect(screen.queryByText('分配一覧を読み込み中…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '読み直す', exact: true }));
    typePlaceSlip('mo', 'SECOND');
    fireEvent.click(screen.getByRole('button', { name: '分配2', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '棚 50013_540AP 北' }));
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
    expect(screen.queryByText('分配一覧を読み込み中…')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getOrderPlacementBranches).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('uses saved no-distribution offline and overlays a queued numbered placement on reread', async () => {
    mocks.realBranches = true;
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    saveOrderBranches('0002178005', { branches: [{ id: 'none', branchNo: 0, shelfCodeRaw: 'A-04',
      manufacturingOrderBarcodeRaw: '0002178005', csvDashboardRowId: null, updatedAt: 'now' }] });
    mount(); typePlaceSlip();
    await waitFor(() => expect(screen.getByRole('button', { name: '分配なし' })).toHaveAttribute('aria-pressed', 'true'));
    await chooseShelf(0);
    expect(screen.getByRole('button', { name: 'ここへ移す' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '読み直す', exact: true }));
    await haizenOfflineQueueStore.put({ clientRecordId: 'pending', branchNo: 2, shelfCode: 'A-04', number: '0002178005',
      status: 'pending', slipKind: 'manufacturing_order', scannedAt: '2026-10-27T00:00:00Z' });
    typePlaceSlip();
    await waitFor(() => expect(screen.getByRole('button', { name: '分配2', exact: true })).toBeEnabled());
    await chooseShelf(2);
    expect(screen.getByRole('button', { name: 'ここへ移す' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '分配なし' })).toBeDisabled();
    expect(getOrderPlacementBranches).not.toHaveBeenCalled();
  });

  it('sends saved shelf registrations when opening the hub', async () => {
    const photo = { contentType: 'image/jpeg' as const, dataBase64: '/9j/' };
    await shelfOfflineQueueStore.put({ id: 'shelf', shelfCodeRaw: '電気室', displayLabel: null, photo,
      createdAt: '2026-10-27T00:00:00Z', stage: 'unregistered', status: 'pending' });
    vi.mocked(api.post).mockResolvedValue({ shelf: { shelfCodeRaw: '電気室', isStructured: true } });
    vi.mocked(api.put).mockResolvedValue({ photoUpdatedAt: 'now' });
    mount();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`/mobile-placement/shelves/${encodeURIComponent('電気室')}/photo`, photo, { timeout: 60_000 }));
    expect(api.post).toHaveBeenCalledWith('/mobile-placement/shelves', { shelfCodeRaw: '電気室', displayLabel: null }, { timeout: 60_000 });
    await waitFor(async () => expect(await shelfOfflineQueueStore.list()).toEqual([]));
    expect(registerOrderPlacement).not.toHaveBeenCalled();
  });

  it('bottom row has four tabs, purchase navigates, and menu dismisses', () => {
    mount();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '手入力', exact: true })).not.toBeInTheDocument();
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
    const slipButton = screen.getByRole('button', { name: '移動票を読む' });
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
    fireEvent.click(screen.getByRole('button', { name: 'open inputs', exact: true }));
    fireEvent.change(screen.getByLabelText('移動票 製造order'), { target: { value: '0002178005' } });
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    typePlaceSlip();
    fireEvent.click(screen.getByRole('button', { name: '分配1', exact: true }));
    const list = within(screen.getByRole('region', { name: '棚の写真' }));
    expect(screen.queryByText('先に票を読む')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '部品' })).toBeInTheDocument();
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
    await waitFor(() => expect(registerOrderPlacement).toHaveBeenCalledWith({ shelfCodeRaw: 'A-03', manufacturingOrderBarcodeRaw: '0002178005', slipKind: 'manufacturing_order', clientRecordId: expect.any(String), placedAt: expect.any(String), branchNo: 1 }, 3000));
    await screen.findByText(/分配1を置きました/);
    expect(screen.getByRole('button', { name: '移動票を読む' })).toBeInTheDocument();
    expect(screen.queryByText('先に票を読む')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '照合' }));
    expect(screen.getByText('0002178005')).toBeInTheDocument();
    expect(screen.getByText('4501238876')).toBeInTheDocument();
  });
  it('links the verified transfer to a branch and shelf only on put, then clears the slips', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof registerOrderPlacement>>) => void;
    vi.mocked(registerOrderPlacement).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    mount();
    expect(screen.getByRole('button', { name: '次を照合' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '現品票を読む' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北' })).toBeDisabled();
    typeSlips();
    const result = await screen.findByRole('status', { name: '一致' });
    expect(result).toHaveClass('shrink-0', 'items-center', 'py-1.5');
    expect(result).toHaveTextContent('FS1 PART1 ブラケット');
    expect(screen.getByRole('group', { name: '分配' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '次を照合' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '分配2', exact: true }));
    const tile = screen.getByRole('button', { name: '棚 50013_540AP 北' });
    expect(tile).toBeEnabled();
    fireEvent.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(registerOrderPlacement).not.toHaveBeenCalled();
    fireEvent.click(tile);
    expect(screen.getByRole('dialog', { name: '棚の写真を拡大' })).toBeInTheDocument();
    expect(registerOrderPlacement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '閉じる', exact: true }));
    const primary = screen.getByRole('button', { name: 'ここに置く' });
    expect(primary.parentElement).toBe(screen.getByRole('button', { name: '移動票を読む' }).parentElement);
    fireEvent.click(primary);
    // The slips clear while the send is still waiting on the network.
    expect(screen.getByRole('button', { name: '移動票を読む' })).not.toHaveTextContent('0002178005');
    expect(screen.queryByRole('button', { name: 'ここに置く' })).not.toBeInTheDocument();
    await waitFor(() => expect(registerOrderPlacement).toHaveBeenCalledExactlyOnceWith({
      shelfCodeRaw: 'A-03', manufacturingOrderBarcodeRaw: '0002178005', slipKind: 'manufacturing_order',
      clientRecordId: expect.any(String), placedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), branchNo: 2
    }, 3000));
    const placementId = vi.mocked(registerOrderPlacement).mock.calls[0][0].clientRecordId;
    expect(await verifyRecordStore.list()).toEqual([expect.objectContaining({
      transferOrderBarcodeRaw: '0002178005', actualOrderBarcodeRaw: '4501238876', clientRecordId: placementId
    })]);
    await act(async () => resolve({ action: 'created', branchState: { branchNo: 2 }, event: { id: 'verify-put' } } as Awaited<ReturnType<typeof registerOrderPlacement>>));
    const toast = await screen.findByText('50013_540AP 北に 分配2を置きました');
    expect(toast.closest('main')).toBe(screen.getByRole('main'));
    expect(toast.parentElement).toHaveClass('absolute', 'bottom-2', 'rounded-2xl');
    expect(toast).toHaveClass('break-words');
    expect(screen.getByRole('button', { name: '移動票を読む' })).not.toHaveTextContent('0002178005');
    expect(screen.getByRole('button', { name: '現品票を読む' })).not.toHaveTextContent('4501238876');
    expect(screen.queryByRole('group', { name: '分配' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '次を照合' })).toBeDisabled();
  });

  it('advances verification without selecting a shelf', async () => {
    mount(); typeSlips();
    await screen.findByRole('status', { name: '一致' });
    fireEvent.click(screen.getByRole('button', { name: '次を照合' }));
    expect(screen.getByRole('button', { name: '移動票を読む' })).not.toHaveTextContent('0002178005');
    expect(screen.getByRole('button', { name: '現品票を読む' })).toBeDisabled();
    expect(registerOrderPlacement).not.toHaveBeenCalled();
  });

  it.each(['sent', 'pending', 'needs_check'])('uses the full picker and known no-distribution branch for a verify move (%s)', async (status) => {
    mocks.branches = [{ id: 'none', branchNo: 0, shelfCodeRaw: 'A-04' }];
    vi.mocked(registerOrderPlacement).mockResolvedValue({ action: 'moved', branchState: { branchNo: 0 }, event: { id: 'move' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
    if (status === 'pending') vi.mocked(registerOrderPlacement).mockRejectedValueOnce(new Error('network'));
    if (status === 'needs_check') vi.mocked(registerOrderPlacement).mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
    mount(); typeSlips();
    await screen.findByRole('status', { name: '一致' });
    expect(screen.getByRole('button', { name: '分配なし' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '分配1', exact: true })).toBeDisabled();
    expect(within(screen.getByRole('button', { name: '棚 研削 南' })).getByText('前回')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '棚 研削 南' }));
    expect(screen.getByRole('button', { name: '今と同じ棚です' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '大きい画面で選ぶ' }));
    const picker = within(screen.getByRole('dialog', { name: '棚を選ぶ' }));
    fireEvent.click(picker.getByRole('button', { name: '全部', exact: true }));
    fireEvent.click(picker.getByRole('button', { name: '棚 50013_540AP 北' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北' })).toHaveAttribute('aria-pressed', 'true');
    expect(registerOrderPlacement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ここへ移す' }));
    await screen.findByText(status === 'sent' ? '50013_540AP 北に 分配なしを移しました' : status === 'pending' ? 'スマホに保存しました（未送信 1件）' : '要確認に保存しました');
    expect(registerOrderPlacement).toHaveBeenCalledWith(expect.objectContaining({ branchNo: 0, shelfCodeRaw: 'A-03', slipKind: 'manufacturing_order' }), 3000);
    expect(screen.getByRole('button', { name: '移動票を読む' })).not.toHaveTextContent('0002178005');
  });

  it.each(['transfer', 'actual'] as const)('resets verification shelf and branch when %s changes', async (field) => {
    mocks.branches = [{ id: 'b1', branchNo: 1, shelfCodeRaw: 'A-04' }];
    mount(); typeSlips();
    await screen.findByRole('status', { name: '一致' });
    expect(screen.getByRole('button', { name: '分配なし' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '分配1', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '棚 50013_540AP 北' }));
    expect(screen.getByRole('button', { name: 'ここへ移す' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'open inputs' }));
    fireEvent.change(screen.getByLabelText(field === 'transfer' ? '移動票 製造order' : '現品票 注文番号 / 製造order'), { target: { value: 'NEW' } });
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    await screen.findByRole('status', { name: '一致' });
    expect(screen.getByRole('button', { name: '分配1', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '次を照合' })).toBeEnabled();
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
    fireEvent.click(screen.getByRole('button', { name: 'open inputs', exact: true }));
    fireEvent.change(screen.getByLabelText('移動票 部品番号'), { target: { value: 'P1' } });
    fireEvent.change(screen.getByLabelText('現品票 部品番号'), { target: { value: 'P2' } });
    fireEvent.change(screen.getByLabelText('現品票 製番'), { target: { value: 'F1' } });
    await waitFor(() => expect(verifyMobilePlacementSlipMatch).toHaveBeenLastCalledWith(expect.objectContaining({ transferPartBarcodeRaw: 'P1', actualPartBarcodeRaw: 'P2', actualFseibanRaw: 'F1' })));
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    fireEvent.click(screen.getByRole('button', { name: '現品票を読む' }));
    expect(screen.queryByRole('status', { name: '一致' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '現品票を読む' })).toBeInTheDocument();
  });
  it.each(['manual', 'scan'] as const)('clears a stale transfer part after a new order via %s', async (method) => {
    mount(); typeSlips();
    await screen.findByRole('status', { name: '一致' });
    fireEvent.click(screen.getByRole('button', { name: 'open inputs' }));
    fireEvent.change(screen.getByLabelText('移動票 部品番号'), { target: { value: 'STALE' } });
    await waitFor(() => expect(verifyMobilePlacementSlipMatch).toHaveBeenLastCalledWith(expect.objectContaining({ transferPartBarcodeRaw: 'STALE' })));
    if (method === 'manual') {
      fireEvent.change(screen.getByLabelText('移動票 製造order'), { target: { value: '0004099556' } });
    } else {
      mocks.scanValue = '0004099556';
      fireEvent.click(screen.getByRole('button', { name: '移動票 製造orderをスキャン' }));
      fireEvent.click(screen.getByText('scan'));
      fireEvent.click(screen.getByRole('button', { name: 'open inputs' }));
    }
    expect(screen.getByLabelText('移動票 部品番号')).toHaveValue('');
    await waitFor(() => expect(verifyMobilePlacementSlipMatch).toHaveBeenLastCalledWith(expect.objectContaining({ transferOrderBarcodeRaw: '0004099556', transferPartBarcodeRaw: '' })));
  });

  it.each([
    ['', 'MD004883240'],
    ['0002178005', ' MD000006755-002 ']
  ])('routes a part scan without replacing transfer order %j', (order, part) => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'open inputs' }));
    fireEvent.change(screen.getByLabelText('移動票 製造order'), { target: { value: order } });
    fireEvent.change(screen.getByLabelText('移動票 部品番号'), { target: { value: 'STALE' } });
    mocks.scanValue = part;
    fireEvent.click(screen.getByRole('button', { name: '移動票 製造orderをスキャン' }));
    fireEvent.click(screen.getByText('scan'));
    expect(screen.queryByRole('dialog', { name: 'scanner' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'open inputs' }));
    expect(screen.getByLabelText('移動票 製造order')).toHaveValue(order);
    expect(screen.getByLabelText('移動票 部品番号')).toHaveValue(part.trim());
    expect(verifyMobilePlacementSlipMatch).not.toHaveBeenCalled();
  });

  it('keeps alphabetic transfer scans as order values in the place tab', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    mocks.scanValue = 'MD004883240';
    fireEvent.click(screen.getByRole('button', { name: '移動票を読む' }));
    fireEvent.click(screen.getByText('scan'));
    fireEvent.click(screen.getByRole('button', { name: 'open inputs' }));
    expect(screen.getByLabelText('移動票 製造order')).toHaveValue('MD004883240');
    expect(verifyMobilePlacementSlipMatch).not.toHaveBeenCalled();
  });

  describe.each(['api', 'device'] as const)('part mismatch messages via %s', (source) => {
    it.each([
      ['TRANSFER_PART_MISMATCH', '移動票の部品番号が違います'],
      ['ACTUAL_PART_MISMATCH', '現品票の部品番号が違います'],
      ['FSEIBAN_OR_PART_PAIR_MISMATCH', '部品が違います'],
      [undefined, '部品が違います']
    ] as const)('renders %s', async (legacyReason, message) => {
      const response = { ok: false, reason: 'different_part' as const, legacyReason };
      if (source === 'device') vi.spyOn(mobileLocalDataStore, 'verify').mockResolvedValue(response);
      else vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValue(response);
      mount(); typeSlips();
      expect(await screen.findByRole('status', { name: '不一致' })).toHaveTextContent(message);
      if (source === 'device') expect(verifyMobilePlacementSlipMatch).not.toHaveBeenCalled();
      else expect(verifyMobilePlacementSlipMatch).toHaveBeenCalled();
    });
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
    await screen.findByText(/に 分配2を移しました$/);
    expect(registerOrderPlacement).toHaveBeenCalledWith(expect.objectContaining({ branchNo: 2, shelfCodeRaw: 'A-03', clientRecordId: expect.any(String) }), 3000);
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
    fireEvent.click(screen.getByRole('button', { name: 'open inputs', exact: true }));
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
    expect(screen.getByRole('status', { name: '一致' })).toHaveTextContent('FS1 PART1');
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
  it('HTTP 400 failures are errors, with a serialized retry', async () => {
    vi.mocked(verifyMobilePlacementSlipMatch).mockRejectedValueOnce({ isAxiosError: true, response: { status: 400 } });
    mount(); typeSlips();
    await screen.findByText('照合できませんでした');
    expect(screen.queryByText('不一致')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    await screen.findByRole('status', { name: '一致' });
    expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledTimes(2);
  });
  it('registers with only transfer and shelf, and persists the tab', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'open inputs', exact: true }));
    fireEvent.change(screen.getByLabelText('移動票 製造order'), { target: { value: '0002178005' } });
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    await chooseShelf();
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '現品票を読む' })).toBeEnabled();
    expect(verifyMobilePlacementSlipMatch).not.toHaveBeenCalled();
    expect(localStorage.getItem('haizen-tab')).toBe('place');
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    await waitFor(() => expect(registerOrderPlacement).toHaveBeenCalledWith({ shelfCodeRaw: 'A-03', manufacturingOrderBarcodeRaw: '0002178005', slipKind: 'manufacturing_order', clientRecordId: expect.any(String), placedAt: expect.any(String), branchNo: 1 }, 3000));
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
    const mo = screen.getByRole('button', { name: '移動票を読む' });
    const po = screen.getByRole('button', { name: '現品票を読む' });
    expect(mo.parentElement).toBe(po.parentElement);
    const primary = screen.getByRole('button', { name: 'ここに置く' });
    expect(primary).toBeDisabled();
    expect(mo.parentElement).toBe(primary.parentElement);
    expect(po.parentElement).toHaveClass('grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]');
    expect(mo.querySelector('svg')).toBeNull();
    expect(po.querySelector('svg')).toBeNull();
    fireEvent.click(po);
    fireEvent.click(screen.getByText('scan'));
    expect(screen.getByRole('button', { name: '現品票を読む' })).toHaveTextContent('SCANNED');
    expect(within(po).getByText('SCANNED')).toHaveClass('font-mono');
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: '照合' }));
    expect(screen.queryByText('SCANNED')).not.toBeInTheDocument();
    expect(verifyMobilePlacementSlipMatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    expect(screen.getByRole('button', { name: '現品票を読む' })).toHaveTextContent('SCANNED');
    fireEvent.click(screen.getByRole('button', { name: '読み直す' }));
    expect(screen.queryByText('SCANNED')).not.toBeInTheDocument();
  });
  it('shows pending status and sheet after a network error, and clears on reconnection', async () => {
    vi.mocked(registerOrderPlacement).mockRejectedValueOnce(new Error('network'));
    mount(); typePlaceSlip('po', '4501238876'); await chooseShelf();
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    await screen.findByText('スマホに保存しました（未送信 1件）');
    expect(screen.getByText('圏外')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '現品票を読む' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: '現品票を読む' })).toHaveTextContent('SCANNED');
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
    expect(group.parentElement?.nextElementSibling).toBe(screen.getByRole('button', { name: 'ここに置く' }).parentElement);
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
    await waitFor(() => expect(screen.queryByRole('group', { name: '分配' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北', pressed: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '移動票を読む' }));
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
    expect(within(screen.getByRole('button', { name: '棚 研削 南' })).getByText('前回')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '棚 研削 南' }));
    expect(screen.getByRole('button', { name: '今と同じ棚です' })).toBeDisabled();
    vi.mocked(registerOrderPlacement).mockResolvedValue({ action: 'moved', branchState: { branchNo: 0 }, event: { id: 'move' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
    await chooseShelf(0);
    fireEvent.click(screen.getByRole('button', { name: 'ここへ移す' }));
    await screen.findByText(/に 分配なしを移しました$/);
    expect(registerOrderPlacement).toHaveBeenCalledWith(expect.objectContaining({ branchNo: 0 }), 3000);
  });
  it('leaves numbered placements unselected, excludes none and badges only the selected previous shelf', () => {
    mocks.branches = [{ id: 'b1', branchNo: 1, shelfCodeRaw: 'A-03' }, { id: 'b2', branchNo: 2, shelfCodeRaw: 'A-04' }];
    mount(); typePlaceSlip();
    expect(screen.getByRole('button', { name: '分配なし' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '分配2', exact: true }));
    expect(screen.getByRole('button', { name: 'ここへ移す' })).toBeDisabled();
    expect(within(screen.getByRole('button', { name: '棚 研削 南' })).getByText('前回')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北' })).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: '棚 50013_540AP 北' })).queryByText('前回')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '分配5', exact: true }));
    expect(screen.queryByRole('button', { name: '全部', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('前回')).not.toBeInTheDocument();
  });
  it('allows any stamp offline when the branch list is unknown', async () => {
    mocks.branchError = true;
    mocks.branches = [{ id: 'none', branchNo: 0, shelfCodeRaw: 'A-04' }];
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount(); typePlaceSlip();
    for (const button of within(screen.getByRole('group', { name: '分配' })).getAllByRole('button')) expect(button).toBeEnabled();
    expect(screen.queryByText('分配一覧を読み込み中…')).not.toBeInTheDocument();
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
    await screen.findByText(/に 分配なしを置きました$/);
    mocks.branchFetching = true; // Cached empty list remains available with isLoading=false.
    typePlaceSlip();
    expect(screen.getByRole('button', { name: '分配なし' })).toHaveAttribute('aria-pressed', 'false');
    mocks.branches = [{ id: 'none', branchNo: 0, shelfCodeRaw: 'A-03' }];
    mocks.branchFetching = false;
    fireEvent.click(screen.getByRole('button', { name: 'open inputs', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    expect(screen.getByRole('button', { name: '分配なし' })).toHaveAttribute('aria-pressed', 'true');
    for (const no of [1, 2, 3, 4, 5]) expect(screen.getByRole('button', { name: `分配${no}`, exact: true })).toBeDisabled();
  });

  it('uses known saved branches during background refresh', () => {
    mocks.branches = [{ id: 'none', branchNo: 0, shelfCodeRaw: 'A-04' }];
    mocks.branchFetching = true;
    mount(); typePlaceSlip();
    expect(screen.getByRole('button', { name: '分配なし' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '分配2', exact: true })).toBeDisabled();
    expect(screen.queryByText('分配一覧を読み込み中…')).not.toBeInTheDocument();
  });

  it.each([[3, 0], [0, 2]])('clears stamp %i but retains its shelf when the loaded list only permits stamp %i', async (selected, current) => {
    mocks.branchLoading = true;
    mount(); typePlaceSlip(); await chooseShelf(selected);
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
    mocks.branchLoading = false;
    mocks.branches = [{ id: 'current', branchNo: current, shelfCodeRaw: 'A-04' }];
    fireEvent.click(screen.getByRole('button', { name: 'open inputs', exact: true }));
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
    mocks.branchLoading = delayed;
    mocks.branches = [{ id: 'none', branchNo: 0, shelfCodeRaw: 'A-04' }];
    fireEvent.click(screen.getByText('scan'));
    if (delayed) {
      expect(screen.getByRole('button', { name: '分配3', exact: true })).toHaveAttribute('aria-pressed', 'true');
      mocks.branchLoading = false;
    }
    fireEvent.click(screen.getByRole('button', { name: 'open inputs', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    expect(screen.getByRole('button', { name: '棚 50013_540AP 北', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分配3', exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: '分配3', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '分配なし' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ここへ移す' })).toBeEnabled();
  });

});


describe('Haizen scan frame wiring', () => {
  it('attaches the same scan and clientRecordId immediately when placing', async () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    fireEvent.click(screen.getByRole('button', { name: '移動票を読む' }));
    fireEvent.click(screen.getByText('scan'));
    await chooseShelf();
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    const photo = vi.mocked(saveScanFrame).mock.calls.find(([, details]) => details.kind === 'placement-photo');
    expect(photo?.[0].decodedValue).toBe('SCANNED');
    expect(photo?.[1]).toMatchObject({ shelfCodeRaw: 'A-03', slipKind: 'manufacturing_order' });
    await waitFor(async () => expect((await haizenOfflineQueueStore.list())[0]?.clientRecordId).toBe(photo?.[1].clientRecordId));
  });
  it.each(['移動票', '現品票'])('keeps the %s photo after scanning a shelf on the place tab', async (slip) => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    fireEvent.click(screen.getByRole('button', { name: `${slip}を読む` }));
    fireEvent.click(screen.getByText('scan'));
    const capture = vi.mocked(saveScanFrame).mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: '分配1', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '大きい画面で選ぶ' }));
    fireEvent.click(screen.getByRole('button', { name: 'QR', exact: true }));
    mocks.scanValue = 'A-03';
    fireEvent.click(screen.getByText('scan'));
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    const photo = vi.mocked(saveScanFrame).mock.calls.find(([, details]) => details.kind === 'placement-photo');
    expect(photo?.[0]).toBe(capture);
    expect(photo?.[1]).toMatchObject({ shelfCodeRaw: 'A-03', slipKind: slip === '移動票' ? 'manufacturing_order' : 'purchase_order' });
    await waitFor(async () => expect((await haizenOfflineQueueStore.list())[0]?.clientRecordId).toBe(photo?.[1].clientRecordId));
  });
  it.each(['scan', 'manual'])('keeps the transfer photo through actual slip %s and shelf choice on verify', async (mode) => {
    mount();
    mocks.scanValue = '0002178005';
    fireEvent.click(screen.getByRole('button', { name: '移動票を読む' }));
    fireEvent.click(screen.getByText('scan'));
    const capture = vi.mocked(saveScanFrame).mock.calls[0][0];
    if (mode === 'scan') {
      fireEvent.click(screen.getByRole('button', { name: '現品票を読む' }));
      mocks.scanValue = 'ACTUAL';
      fireEvent.click(screen.getByText('scan'));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'open inputs' }));
      fireEvent.change(screen.getByLabelText('現品票 注文番号 / 製造order'), { target: { value: 'ACTUAL' } });
      fireEvent.change(screen.getByLabelText('現品票 部品番号'), { target: { value: 'PART1' } });
      fireEvent.click(screen.getByRole('button', { name: '完了' }));
    }
    await screen.findByRole('status', { name: '一致' });
    fireEvent.click(screen.getByRole('button', { name: '分配1', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: '棚 50013_540AP 北', exact: true }));
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    const photo = vi.mocked(saveScanFrame).mock.calls.find(([, details]) => details.kind === 'placement-photo');
    expect(photo?.[0]).toBe(capture);
    expect(photo?.[1]).toMatchObject({ shelfCodeRaw: 'A-03', slipKind: 'manufacturing_order' });
    await waitFor(async () => expect((await haizenOfflineQueueStore.list())[0]?.clientRecordId).toBe(photo?.[1].clientRecordId));
  });
  it('clears only the reread field when a new scan is aborted', async () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    fireEvent.click(screen.getByRole('button', { name: '移動票を読む' }));
    fireEvent.click(screen.getByText('scan'));
    fireEvent.click(screen.getByRole('button', { name: '移動票を読む' }));
    fireEvent.click(screen.getByText('abort'));
    await chooseShelf();
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    expect(vi.mocked(saveScanFrame).mock.calls.some(([, details]) => details.kind === 'placement-photo')).toBe(false);
  });
  it('does not attach a frame after replacing the number manually', async () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    fireEvent.click(screen.getByRole('button', { name: '移動票を読む' }));
    fireEvent.click(screen.getByText('scan'));
    typePlaceSlip('mo', 'OTHER');
    await chooseShelf();
    fireEvent.click(screen.getByRole('button', { name: 'ここに置く' }));
    expect(vi.mocked(saveScanFrame).mock.calls.some(([, details]) => details.kind === 'placement-photo')).toBe(false);
  });
  it('enriches timeout metadata from the following manual input', () => {
    vi.mocked(saveScanFrame).mockReturnValue('timeout-frame');
    mount();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    fireEvent.click(screen.getByRole('button', { name: '移動票を読む' }));
    fireEvent.click(screen.getByText('timeout'));
    typePlaceSlip('mo', 'MANUAL');
    expect(vi.mocked(saveScanFrame).mock.calls[0][1]).toMatchObject({ kind: 'scan-frame', manualValue: 'MANUAL' });
  });
});
