import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
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
  purchaseOrderNo: '4501238876', rows: [{ machineName: 'ＤＡＤ－３２２０', seiban: 'BA1S2201',
    purchasePartName: 'ナット', masterPartName: 'ナット M12', purchasePartCodeRaw: 'FH-01',
    purchasePartCodeNormalized: 'FH01', acceptedQuantity: 3, plannedStartDate: '2026-10-18' }]
};

function Destination() {
  const location = useLocation();
  return <div>配膳ハブ<output aria-label="遷移">{useNavigationType()} {location.pathname} {location.state?.openHaizenMenu ? 'メニュー' : ''}</output></div>;
}

function mount() {
  render(<MemoryRouter initialEntries={['/lookup']}><Routes>
    <Route path="/lookup" element={<PurchaseOrderLookupPage />} />
    <Route path="*" element={<Destination />} />
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(getKioskPurchaseOrderLookup).mockResolvedValue(data);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => vi.unstubAllGlobals());

describe('PurchaseOrderLookupPage', () => {
  it.each([
    ['照合', '/kiosk/mobile-placement', 'verify'],
    ['配膳', '/kiosk/mobile-placement', 'place'],
    ['部品', '/kiosk/mobile-placement/part-search', null]
  ])('%s タブは履歴を置換する', (tab, path, stored) => {
    mount();
    expect(screen.getByRole('tab', { name: '購買' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: tab }));
    expect(screen.getByLabelText('遷移')).toHaveTextContent(`REPLACE ${path}`);
    if (stored) expect(localStorage.getItem('haizen-tab')).toBe(stored);
  });

  it('メニューを開く state を付けてハブへ置換する', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'ほかの画面' }));
    expect(screen.getByLabelText('遷移')).toHaveTextContent('REPLACE /kiosk/mobile-placement メニュー');
  });

  it('uses the phone scan flow, ghost digits, ordered result fields and hub tabs', async () => {
    mount();
    const bottom = screen.getByRole('contentinfo');
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(bottom).toContainElement(screen.getByRole('tablist', { name: '作業' }));
    expect(bottom).toContainElement(screen.getByRole('button', { name: '注文番号を読む' }));
    expect(bottom.parentElement?.lastElementChild).toBe(bottom);
    expect(screen.getByText('0000000000')).toHaveClass('text-[var(--hp-line)]');
    fireEvent.click(screen.getByRole('button', { name: '注文番号を読む' }));
    expect(scanProps).toHaveBeenLastCalledWith(expect.objectContaining({ formats: BARCODE_FORMAT_PRESET_PURCHASE_ORDER, engine: 'auto-native', ...KIOSK_STANDARD_BARCODE_SCAN_SESSION }));
    fireEvent.click(screen.getByRole('button', { name: '部分読取' }));
    expect(screen.getByLabelText('注文番号 450')).toHaveTextContent('4500000000');
    expect(getKioskPurchaseOrderLookup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '注文番号を読む' }));
    fireEvent.click(screen.getByRole('button', { name: '読取成功' }));
    expect(await screen.findByText('DAD-3220')).toBeInTheDocument();
    const card = screen.getByLabelText('照会結果1件');
    expect(card.tagName).toBe('DL');
    expect(Array.from(card.querySelectorAll('dt')).map((item) => item.textContent)).toEqual(['機種名', '品名', '製番', '着手', '品番', '個数', '部品マスタ']);
    expect(Array.from(card.querySelectorAll('dd')).map((item) => item.textContent)).toEqual(['DAD-3220', 'ナット', 'BA1S2201', '2026-10-18', 'FH-01', '3個', '部品マスタでは「ナット M12」']);
    expect(getKioskPurchaseOrderLookup).toHaveBeenCalledWith('4501238876', 'test-key');
    expect(screen.getByText('1件')).toBeInTheDocument();
    expect(screen.getByText('部品マスタでは「ナット M12」')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '次の注文番号を読む' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '照合' }));
    expect(screen.getByText('配膳ハブ')).toBeInTheDocument();
    expect(localStorage.getItem('haizen-tab')).toBe('verify');
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
    await screen.findByText('DAD-3220');
    act(() => { media.matches = true; notify(); });
    expect(screen.getByRole('tab', { name: '購買' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('DAD-3220')).toBeInTheDocument();
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
    expect(screen.queryByLabelText('照会結果1件')).not.toBeInTheDocument();
  });
});
