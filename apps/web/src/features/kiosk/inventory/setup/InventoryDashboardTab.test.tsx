import { normalizeToolValue, type InventoryDashboard } from '@raspi-system/shared-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getInventoryDashboard, getInventoryValueVariants, mergeInventoryValueVariants, dismissInventoryValueVariants } from '../../../../api/client';

import { InventoryDashboardTab } from './InventoryDashboardTab';
import { clearSetupPin, rememberSetupPin } from './setupPinSession';

vi.mock('../../../../api/client', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../api/client')>(),
  getInventoryDashboard: vi.fn(), getInventoryValueVariants: vi.fn(), mergeInventoryValueVariants: vi.fn(), dismissInventoryValueVariants: vi.fn(),
}));
const data: InventoryDashboard = {
  weeks: [{ weekStart: '2026-10-05', issued: 2 }, { weekStart: '2026-10-12', issued: 4 }], totalIssued: 6, previousTotalIssued: 3,
  items: [
    { id: '1', name: 'ドリルA', labelNumbers: [12], toolName: 'ドリル', maker: 'OSG', unit: '本', unitPrice: null, stock: 2, issued: 2, weekly: [0, 2] },
    { id: '2', name: 'ドリルB', labelNumbers: [13], toolName: 'ﾄﾞﾘﾙ', maker: 'osg', unit: '本', unitPrice: null, stock: 5, issued: 4, weekly: [2, 2] },
  ], lowStockCount: 1, pricedItemCount: 0, itemCount: 2, machines: ['A', 'B'], cost: { total: 0, previousTotal: 0, byMonth: [{ month: '2026-10', amount: 0 }] },
};
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onEditItems = vi.fn();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><InventoryDashboardTab accessPassword="2520" onEditItems={onEditItems} /></QueryClientProvider>);
  return { onEditItems, invalidate };
}
describe('InventoryDashboardTab', () => {
  beforeEach(() => {
    vi.clearAllMocks(); rememberSetupPin('2520');
    vi.mocked(getInventoryDashboard).mockResolvedValue(data);
    vi.mocked(getInventoryValueVariants).mockResolvedValue({ groups: [{ field: 'maker', to: 'OSG', from: [{ value: 'オーエスジー', count: 2 }], auto: false }], autoMergedValueCount: 3 });
    vi.mocked(mergeInventoryValueVariants).mockResolvedValue({});
    vi.mocked(dismissInventoryValueVariants).mockResolvedValue({});
  });
  afterEach(clearSetupPin);
  it('uses shared normalization on the web', () => { expect(normalizeToolValue('  ａｂＣ　  ｶｯﾀｰ ')).toBe('ABC カッター'); });
  it('renders tiles, normalized kinds, raw spellings, charts and price placeholder', async () => {
    mount();
    expect(await screen.findByRole('region', { name: '持出', exact: true })).toHaveTextContent('6 本');
    expect(screen.getByText('前の12週より +100%')).toBeInTheDocument();
    expect(screen.getByText('1 種類')).toBeInTheDocument();
    expect(screen.getByText('入力のままだと 2種類')).toBeInTheDocument();
    expect(screen.getByText('▲ 残り2本以下')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '週ごとの持出グラフ' })).toBeInTheDocument();
    expect(screen.getByTitle('ドリル / ﾄﾞﾘﾙ')).toHaveTextContent('2表記');
    expect(screen.queryByRole('img', { name: '月ごとの金額グラフ' })).not.toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    expect(getInventoryDashboard).toHaveBeenCalledWith(12, undefined, '2520');
  });
  it('refetches selected period and machine, and toggles dimension', async () => {
    mount(); await screen.findByRole('region', { name: '持出', exact: true });
    fireEvent.click(screen.getByRole('button', { name: '4週' }));
    await waitFor(() => expect(getInventoryDashboard).toHaveBeenLastCalledWith(4, undefined, '2520'));
    fireEvent.change(screen.getByLabelText('場所'), { target: { value: 'A' } });
    await waitFor(() => expect(getInventoryDashboard).toHaveBeenLastCalledWith(4, 'A', '2520'));
    await screen.findByRole('button', { name: 'メーカー' });
    fireEvent.click(screen.getByRole('button', { name: 'メーカー' }));
    expect(screen.getByRole('heading', { name: 'メーカー別の持出' })).toBeInTheDocument();
    expect(screen.getByTitle('OSG / osg')).toHaveTextContent('2表記');
  });
  it.each([true, false])('calls merge/dismiss APIs and invalidates dependent queries (merge=%s)', async merge => {
    const { invalidate } = mount();
    fireEvent.click(await screen.findByRole('button', { name: merge ? 'OSG にまとめる' : '別のもの' }));
    if (merge) await waitFor(() => expect(mergeInventoryValueVariants).toHaveBeenCalledWith({ field: 'maker', to: 'OSG', from: ['オーエスジー'] }, '2520'));
    else await waitFor(() => expect(dismissInventoryValueVariants).toHaveBeenCalledWith({ field: 'maker', values: ['OSG', 'オーエスジー'] }, '2520'));
    expect(await screen.findByText(merge ? '表記をまとめました' : '別のものとして残しました')).toBeInTheDocument();
    for (const key of ['inventory-dashboard', 'inventory-value-variants', 'inventory-tool-field-values']) expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
  });
  it('shows monthly cost after price entry and navigates to editing', async () => {
    vi.mocked(getInventoryDashboard).mockResolvedValue({ ...data, pricedItemCount: 1, cost: { total: 1200, previousTotal: 600, byMonth: [{ month: '2026-10', amount: 1200 }] } });
    const { onEditItems } = mount();
    expect(await screen.findByText('¥1,200')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '月ごとの金額グラフ' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '単価を入れる' }));
    expect(onEditItems).toHaveBeenCalledOnce();
  });
  it('shows empty suggestions, full-height hover tooltip and loading/error states', async () => {
    vi.mocked(getInventoryValueVariants).mockResolvedValue({ groups: [], autoMergedValueCount: 0 });
    mount();
    expect(screen.getAllByText('読み込み中…').length).toBeGreaterThan(0);
    expect(await screen.findByText('確認するものはありません')).toBeInTheDocument();
    const chart = screen.getByRole('img', { name: '週ごとの持出グラフ' });
    const hit = within(chart).getByText('10/12 の週 4 本', { exact: false }).parentElement!;
    fireEvent.mouseEnter(hit);
    expect(screen.getByRole('tooltip')).toHaveTextContent('10/12 の週 4 本');
  });
  it('shows fetch errors and merge errors near the panel', async () => {
    vi.mocked(mergeInventoryValueVariants).mockRejectedValue(new Error('保存できません'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'OSG にまとめる' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存できません');
  });
});
