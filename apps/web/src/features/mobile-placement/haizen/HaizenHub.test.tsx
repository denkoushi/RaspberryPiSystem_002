import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { moveOrderPlacementBranch, registerOrderPlacement, verifyMobilePlacementSlipMatch } from '../../../api/client';
import { BarcodeScanModal } from '../../barcode-scan';
import { useMobilePlacementPageState } from '../useMobilePlacementPageState';
import { useOrderPlacementBranches } from '../useOrderPlacementBranches';
import { useRegisteredShelves } from '../useRegisteredShelves';

import { HaizenHub } from './HaizenHub';

import type { HaizenHubSheet } from './HaizenHub';

const mocks = vi.hoisted(() => ({ branches: [] as { id: string; branchNo: number; shelfCodeRaw: string }[] }));
vi.mock('../../../api/client', () => ({
  moveOrderPlacementBranch: vi.fn(), registerOrderPlacement: vi.fn(),
  verifyMobilePlacementSlipMatch: vi.fn(), parseActualSlipImage: vi.fn()
}));
vi.mock('../../barcode-scan', () => ({
  KIOSK_STANDARD_BARCODE_SCAN_SESSION: {},
  BarcodeScanModal: ({ open, onSuccess, onAbort, engine }: { open: boolean; onSuccess: (v: string) => void; onAbort: () => void; engine: string }) => open
    ? <div role="dialog" aria-label="scanner"><span>{engine}</span><button onClick={() => onSuccess('SCANNED')}>scan</button><button onClick={onAbort}>abort</button></div> : null
}));
vi.mock('../useRegisteredShelves', () => ({ useRegisteredShelves: () => ({
  data: { shelves: [{ shelfCodeRaw: '西-北-02', isStructured: true, areaId: 'west', lineId: 'north', slot: 2 }] },
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
    <BarcodeScanModal open={mp.scanField !== null} formats={mp.scanFormats} engine="auto-native" onSuccess={mp.onScanSuccess} onAbort={() => mp.setScanField(null)} />
    <HaizenHub mp={mp} sheet={sheet} setSheet={setSheet} shelves={shelves} branches={branches} suggestedNextBranchNo={Math.max(0, ...mocks.branches.map((b) => b.branchNo)) + 1} onNavigate={navigate} onShelfMaster={() => navigate('/kiosk/mobile-placement/shelf-master')} onPhoto={() => {}} />
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
async function chooseShelf() {
  fireEvent.click(await screen.findByRole('button', { name: '一覧から棚を選ぶ' }));
  fireEvent.click(screen.getByRole('button', { name: '西', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '北', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '棚 西-北-02', exact: true }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.branches = [];
  vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValue({ ok: true });
});

describe('Haizen hub', () => {
  it('five menu routes, Escape and scrim dismiss', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'ほかの画面' }));
    expect(within(screen.getByRole('dialog')).getAllByRole('button')).toHaveLength(5);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ほかの画面' }));
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ほかの画面' }));
    fireEvent.click(screen.getByRole('button', { name: '購買照会' }));
    expect(screen.getByText('sub-screen')).toBeInTheDocument();
  });
  it('auto verifies, syncs registration order, registers and resets all fields', async () => {
    vi.mocked(registerOrderPlacement).mockResolvedValue({ branchState: { id: 'b1', branchNo: 1, shelfCodeRaw: '西-北-02' }, event: { id: 'event1234' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
    mount();
    typeSlips();
    await waitFor(() => expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledTimes(1));
    expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledWith({ transferOrderBarcodeRaw: '0002178005', actualOrderBarcodeRaw: '4501238876', transferPartBarcodeRaw: '', actualPartBarcodeRaw: '', actualFseibanRaw: '' });
    expect(screen.queryByRole('button', { name: '写真から読む' })).not.toBeInTheDocument();
    await chooseShelf();
    fireEvent.click(screen.getByRole('button', { name: '棚 西-北-02 に置く' }));
    await waitFor(() => expect(registerOrderPlacement).toHaveBeenCalledWith({ shelfCodeRaw: '西-北-02', manufacturingOrderBarcodeRaw: '0002178005' }));
    await screen.findByText(/分配1を登録/);
    expect(screen.getByText('製造order を読む')).toBeInTheDocument();
    expect(screen.getByText('注文番号 を読む')).toBeInTheDocument();
    expect(screen.getByText('棚の QR を読む')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '写真から読む' })).toBeInTheDocument();
  });
  it('keeps supplementary inputs in verification and rechecks changes', async () => {
    mount();
    typeSlips();
    await screen.findByRole('status', { name: '一致' });
    fireEvent.click(screen.getByRole('button', { name: '部品番号・手入力' }));
    fireEvent.change(screen.getByLabelText('移動票 部品番号'), { target: { value: 'P1' } });
    fireEvent.change(screen.getByLabelText('現品票 部品番号'), { target: { value: 'P2' } });
    fireEvent.change(screen.getByLabelText('現品票 製番'), { target: { value: 'F1' } });
    await waitFor(() => expect(verifyMobilePlacementSlipMatch).toHaveBeenLastCalledWith(expect.objectContaining({ transferPartBarcodeRaw: 'P1', actualPartBarcodeRaw: 'P2', actualFseibanRaw: 'F1' })));
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    fireEvent.click(screen.getByRole('button', { name: '現品票をクリア' }));
    expect(screen.queryByRole('status', { name: '一致' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '写真から読む' })).toBeInTheDocument();
  });
  it('mismatch retries the actual slip, scanner stays auto-native', async () => {
    vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValue({ ok: false });
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
    fireEvent.click(screen.getByRole('button', { name: '棚 西-北-02 に置く' }));
    await screen.findByText('移動できません');
    expect(moveOrderPlacementBranch).toHaveBeenCalledWith({ branchStateId: 'branch-2', shelfCodeRaw: '西-北-02' });
    expect(screen.getByText('0002178005')).toBeInTheDocument();
    expect(registerOrderPlacement).not.toHaveBeenCalled();
  });
  it('serializes changed slips while a verification request is pending', async () => {
    let resolve!: (value: { ok: boolean }) => void;
    vi.mocked(verifyMobilePlacementSlipMatch).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    mount();
    typeSlips();
    await waitFor(() => expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '手入力', exact: true }));
    fireEvent.change(screen.getByLabelText('現品票 注文番号 / 製造order'), { target: { value: 'NEW' } });
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    expect(screen.getByRole('button', { name: '照合中…' })).toBeDisabled();
    expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ ok: false }); });
    await screen.findByRole('status', { name: '一致' });
    expect(verifyMobilePlacementSlipMatch).toHaveBeenCalledTimes(2);
    expect(verifyMobilePlacementSlipMatch).toHaveBeenLastCalledWith(expect.objectContaining({ actualOrderBarcodeRaw: 'NEW' }));
  });
});
