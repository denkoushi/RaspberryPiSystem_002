import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getKioskPurchaseOrderLookup } from '../../api/client';
import { BARCODE_FORMAT_PRESET_PURCHASE_ORDER, KIOSK_STANDARD_BARCODE_SCAN_SESSION } from '../../features/barcode-scan';

import { PurchaseOrderLookupPage } from './PurchaseOrderLookupPage';

import type { PurchaseOrderLookupResponse } from '../../api/client';
import type { BarcodeScanModalProps } from '../../features/barcode-scan/BarcodeScanModal';

const scanProps = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({ getKioskPurchaseOrderLookup: vi.fn() }));
vi.mock('../../lib/client-key', () => ({ resolveClientKey: () => ({ key: 'test-key' }) }));
vi.mock('../../features/barcode-scan', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../features/barcode-scan')>(),
  BarcodeScanModal: (props: BarcodeScanModalProps) => {
    scanProps(props);
    return props.open ? <div role="dialog" aria-label="スキャナ">
      <button onClick={() => props.onSuccess('4501238876')}>読取成功</button>
      <button onClick={() => props.onSuccess('450')}>部分読取</button>
      <button onClick={props.onAbort}>取消</button>
    </div> : null;
  }
}));

const data: PurchaseOrderLookupResponse = {
  purchaseOrderNo: '4501238876', rows: [{ machineName: 'DAD3350', seiban: 'BA1S2201',
    purchasePartName: 'ナット', masterPartName: 'ナット M12', purchasePartCodeRaw: 'FH-01',
    purchasePartCodeNormalized: 'FH01', acceptedQuantity: 3, plannedStartDate: '2026-10-18' }]
};

function mount() {
  render(<MemoryRouter initialEntries={['/lookup']}><Routes>
    <Route path="/lookup" element={<PurchaseOrderLookupPage />} />
    <Route path="/kiosk/mobile-placement" element={<div>配膳ハブ</div>} />
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getKioskPurchaseOrderLookup).mockResolvedValue(data);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => vi.unstubAllGlobals());

describe('PurchaseOrderLookupPage', () => {
  it('uses the phone scan flow, ghost digits, result fields and hub back link', async () => {
    mount();
    expect(screen.getByText('0000000000')).toHaveClass('text-[var(--hp-line)]');
    fireEvent.click(screen.getByRole('button', { name: '注文番号を読む' }));
    expect(scanProps).toHaveBeenLastCalledWith(expect.objectContaining({ formats: BARCODE_FORMAT_PRESET_PURCHASE_ORDER, engine: 'auto-native', ...KIOSK_STANDARD_BARCODE_SCAN_SESSION }));
    fireEvent.click(screen.getByRole('button', { name: '部分読取' }));
    expect(screen.getByLabelText('注文番号 450')).toHaveTextContent('4500000000');
    expect(getKioskPurchaseOrderLookup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '注文番号を読む' }));
    fireEvent.click(screen.getByRole('button', { name: '読取成功' }));
    expect(await screen.findByText('DAD3350')).toBeInTheDocument();
    expect(getKioskPurchaseOrderLookup).toHaveBeenCalledWith('4501238876', 'test-key');
    expect(screen.getByText('1件')).toBeInTheDocument();
    expect(screen.getByText('部品マスタでは「ナット M12」')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '次の注文番号を読む' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.getByText('配膳ハブ')).toBeInTheDocument();
  });

  it('submits manual input through the same lookup handler and handles empty results', async () => {
    vi.mocked(getKioskPurchaseOrderLookup).mockResolvedValue({ purchaseOrderNo: data.purchaseOrderNo, rows: [] });
    mount();
    fireEvent.click(screen.getByRole('button', { name: '手入力' }));
    const dialog = screen.getByRole('dialog', { name: '注文番号を入力' });
    expect(within(dialog).getByRole('button', { name: '照会' })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: '注文番号10桁' }), { target: { value: data.purchaseOrderNo } });
    fireEvent.click(within(dialog).getByRole('button', { name: '照会' }));
    expect(await screen.findByText('データがありません')).toBeInTheDocument();
    expect(screen.getByText('0件')).toBeInTheDocument();
  });

  it('keeps the existing desktop controls and cards when matchMedia is absent', async () => {
    vi.stubGlobal('matchMedia', undefined);
    mount();
    expect(screen.getByRole('button', { name: '← 配膳に戻る' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '注文番号10桁（スキャンで入力）' })).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: '手入力' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'スキャン', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '読取成功' }));
    expect(await screen.findByText('既存DB: ナット M12')).toBeInTheDocument();
    expect(screen.queryByText('部品マスタでは「ナット M12」')).not.toBeInTheDocument();
  });

  it('switches views on viewport changes while preserving lookup state', async () => {
    let notify = () => {};
    const media = { matches: false, addEventListener: vi.fn((_name, callback) => { notify = callback; }), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'スキャン', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '読取成功' }));
    await screen.findByText('DAD3350');
    act(() => { media.matches = true; notify(); });
    expect(screen.getByRole('heading', { name: '購買照会' })).toBeInTheDocument();
    expect(screen.getByText('DAD3350')).toBeInTheDocument();
    act(() => { media.matches = false; notify(); });
    expect(screen.getByRole('button', { name: 'スキャン', exact: true })).toBeInTheDocument();
    expect(screen.getByText('既存DB: ナット M12')).toBeInTheDocument();
  });

  it('shows lookup failures without retaining misleading result cards', async () => {
    vi.mocked(getKioskPurchaseOrderLookup).mockRejectedValue(new Error('通信エラー'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: '注文番号を読む' }));
    fireEvent.click(screen.getByRole('button', { name: '読取成功' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('通信エラー');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
