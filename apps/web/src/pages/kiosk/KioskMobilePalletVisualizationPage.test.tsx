import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../api/client';
import { BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE, KIOSK_STANDARD_BARCODE_SCAN_SESSION } from '../../features/barcode-scan';

import { KioskMobilePalletVisualizationPage } from './KioskMobilePalletVisualizationPage';
import { KioskPalletVisualizationPage } from './KioskPalletVisualizationPage';

import type { BarcodeScanModalProps } from '../../features/barcode-scan/BarcodeScanModal';

const scanProps = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({
  getResolvedClientKey: () => 'test', getKioskPalletVisualizationBoard: vi.fn(),
  postKioskPalletVisualizationItem: vi.fn(), postKioskPalletVisualizationItemReplace: vi.fn(),
  deleteKioskPalletVisualizationItem: vi.fn(), clearKioskPalletVisualizationPallet: vi.fn(),
}));
vi.mock('../../features/barcode-scan/useKeyboardWedgeScan', () => ({ useKeyboardWedgeScan: vi.fn() }));
vi.mock('../../features/barcode-scan/useSerialBarcodeStream', () => ({ useSerialBarcodeStream: vi.fn() }));
vi.mock('../../features/barcode-scan', async (original) => ({
  ...await original<typeof import('../../features/barcode-scan')>(),
  BarcodeScanModal: (props: BarcodeScanModalProps) => {
    scanProps(props);
    return props.open ? <div role="dialog"><button onClick={() => props.onSuccess('1234567890')}>読取成功</button><button onClick={props.onAbort}>取消</button></div> : null;
  },
}));

const item: api.PalletVisualizationItemDto = {
  id: 'item1', machineCd: 'M1', palletNo: 1, displayOrder: 1, fhincd: 'PART1', fhinmei: '取付板', fseiban: 'SEIBAN1',
  machineName: null, machineNameDisplay: null, outsideDimensionsDisplay: null, csvDashboardRowId: null, plannedStartDateDisplay: '2026-10-08', plannedQuantity: 4,
};
const board: api.PalletVisualizationBoardResponseDto = {
  machines: [
    { machineCd: 'M1', machineName: '加工機1', illustrationUrl: null, palletCount: 7, pallets: [{ palletNo: 1, items: [item] }, { palletNo: 3, items: Array.from({ length: 5 }, (_, i) => ({ ...item, id: `many${i}`, palletNo: 3 })) }] },
    { machineCd: 'M2', machineName: '加工機2', illustrationUrl: null, palletCount: 12, pallets: [] },
  ],
};
function mount(desktop = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{desktop ? <KioskPalletVisualizationPage /> : <KioskMobilePalletVisualizationPage />}</MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.mocked(api.getKioskPalletVisualizationBoard).mockResolvedValue(board);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('phone pallet route', () => {
  it('uses the admin pallet count, including empty pallets, and displays real item fields', async () => {
    mount(); await screen.findByText('取付板');
    const tiles = screen.getByRole('group', { name: 'パレット番号' });
    expect(within(tiles).getAllByRole('button')).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'パレット 3・5件' })).toHaveTextContent('+2');
    expect(screen.getByText('SEIBAN1 · PART1 · 着手 10/8')).toBeInTheDocument();
    expect(screen.getByText('4', { selector: 'span.col-start-2' })).toHaveTextContent('×4');
    fireEvent.click(screen.getByRole('button', { name: '加工機2', exact: true }));
    expect(within(tiles).getAllByRole('button')).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: 'パレット 12・0件' }));
    expect(screen.getByRole('button', { name: '読んで No.12 に載せる' })).toBeInTheDocument();
  });

  it('requires a second tap within three seconds and disarms on pallet changes', async () => {
    mount(); await screen.findByText('取付板'); vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '全部外す' }));
    expect(api.clearKioskPalletVisualizationPallet).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole('button', { name: '全部外す' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部外す' }));
    fireEvent.click(screen.getByRole('button', { name: 'パレット 3・5件' }));
    expect(screen.queryByRole('button', { name: 'もう一度で全部外す' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部外す' }));
    fireEvent.click(screen.getByRole('button', { name: 'もう一度で全部外す' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(api.clearKioskPalletVisualizationPallet).toHaveBeenCalledWith('M1', 3, 'test');
  });

  it('scans to add or replace the selected item, and can deselect', async () => {
    mount(); await screen.findByText('取付板');
    fireEvent.click(screen.getByRole('button', { name: '読んで No.1 に載せる' }));
    expect(scanProps).toHaveBeenLastCalledWith(expect.objectContaining({ ...KIOSK_STANDARD_BARCODE_SCAN_SESSION, formats: BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE }));
    fireEvent.click(screen.getByRole('button', { name: '読取成功' }));
    await waitFor(() => expect(api.postKioskPalletVisualizationItem).toHaveBeenCalledWith({ machineCd: 'M1', palletNo: 1, manufacturingOrderBarcodeRaw: '1234567890' }, 'test'));
    await waitFor(() => expect(screen.getByRole('button', { name: /取付板/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /取付板/ }));
    fireEvent.click(screen.getByRole('button', { name: '入れ替え' }));
    fireEvent.click(screen.getByRole('button', { name: '読取成功' }));
    await waitFor(() => expect(api.postKioskPalletVisualizationItemReplace).toHaveBeenCalledWith('item1', { manufacturingOrderBarcodeRaw: '1234567890' }, 'test'));
    await waitFor(() => expect(screen.getByRole('button', { name: /取付板/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /取付板/ }));
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.getByRole('button', { name: '読んで No.1 に載せる' })).toBeInTheDocument();
  });

  it('confirms item deletion and shows clear/delete failures near the controls', async () => {
    vi.mocked(api.deleteKioskPalletVisualizationItem).mockRejectedValueOnce(new Error('外せません'));
    mount(); await screen.findByText('取付板');
    fireEvent.click(screen.getByRole('button', { name: /取付板/ }));
    fireEvent.click(screen.getByRole('button', { name: '外す', exact: true }));
    expect(api.deleteKioskPalletVisualizationItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'もう一度で外す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('外せません');
    expect(api.deleteKioskPalletVisualizationItem).toHaveBeenCalledWith('item1', 'test');
  });

  it('keeps the desktop route rendering its original controls even on a phone viewport', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    mount(true); await screen.findByText('取付板');
    expect(screen.getByRole('heading', { name: 'パレット可視化' })).toHaveClass('text-lg', 'text-emerald-200');
    expect(screen.getByText('加工機（資源CD順）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全削除' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'パレット', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '全部外す' })).not.toBeInTheDocument();
  });
});
