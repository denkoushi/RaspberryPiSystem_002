import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getInventoryDashboard, getInventoryValueVariants, mergeInventoryValueVariants, dismissInventoryValueVariants, verifyKioskDueManagementAccessPassword } from '../../api/client';
import { clearSetupPin, readSetupPin, rememberSetupPin } from '../../features/kiosk/inventory/setup/setupPinSession';

import { KioskItemInventoryDashboardPage } from './KioskItemInventoryDashboardPage';

vi.mock('../../api/client', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/client')>(),
  getInventoryDashboard: vi.fn(), getInventoryValueVariants: vi.fn(),
  mergeInventoryValueVariants: vi.fn(), dismissInventoryValueVariants: vi.fn(),
  verifyKioskDueManagementAccessPassword: vi.fn(),
}));

function SettingsDestination() {
  const location = useLocation();
  return <div data-testid="destination">{location.pathname}:{JSON.stringify(location.state)}</div>;
}

function renderPage() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={['/kiosk/inventory/dashboard']}>
    <Routes>
      <Route path="/kiosk/inventory/dashboard" element={<KioskItemInventoryDashboardPage />} />
      <Route path="/kiosk/inventory/settings" element={<SettingsDestination />} />
    </Routes>
  </MemoryRouter></QueryClientProvider>);
}

describe('KioskItemInventoryDashboardPage', () => {
  beforeEach(() => {
    clearSetupPin();
    vi.clearAllMocks();
    vi.mocked(verifyKioskDueManagementAccessPassword).mockResolvedValue({ success: true } as never);
    vi.mocked(getInventoryDashboard).mockResolvedValue({ weeks: [], items: [], machines: [], totalIssued: 0, previousTotalIssued: 0, lowStockCount: 0, pricedItemCount: 0, itemCount: 0, cost: { total: 0, previousTotal: 0, byMonth: [] } });
    vi.mocked(getInventoryValueVariants).mockResolvedValue({ groups: [{ field: 'maker', to: 'OSG', from: [{ value: 'オーエスジー', count: 2 }], auto: false }], autoMergedValueCount: 0 });
    vi.mocked(mergeInventoryValueVariants).mockResolvedValue({});
    vi.mocked(dismissInventoryValueVariants).mockResolvedValue({});
  });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the dashboard without a PIN', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'OSG にまとめる' })).toBeInTheDocument();
    expect(screen.queryByText('4桁のパスワード')).not.toBeInTheDocument();
    expect(screen.queryByText('解除中')).not.toBeInTheDocument();
    expect(getInventoryDashboard).toHaveBeenCalledWith(12, undefined, undefined);
    expect(getInventoryValueVariants).toHaveBeenCalledWith(undefined);
  });

  it.each([true, false])('unlocks and performs the pending action once (merge=%s)', async merge => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: merge ? 'OSG にまとめる' : '別のもの' }));
    const keypad = within(screen.getByRole('group', { name: 'パスワードのテンキー' }));
    expect(mergeInventoryValueVariants).not.toHaveBeenCalled();
    expect(dismissInventoryValueVariants).not.toHaveBeenCalled();
    for (const digit of '2520') fireEvent.click(keypad.getByRole('button', { name: digit, exact: true }));
    const mutation = merge ? mergeInventoryValueVariants : dismissInventoryValueVariants;
    await waitFor(() => expect(mutation).toHaveBeenCalledExactlyOnceWith(merge
      ? { field: 'maker', to: 'OSG', from: ['オーエスジー'] }
      : { field: 'maker', values: ['OSG', 'オーエスジー'] }, '2520'));
    expect(readSetupPin()).toBe('2520');
    expect(screen.getByRole('heading', { name: '集計' })).toBeInTheDocument();
  });

  it('cancels without performing the pending merge', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'OSG にまとめる' }));
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(await screen.findByRole('button', { name: 'OSG にまとめる' })).toBeInTheDocument();
    expect(mergeInventoryValueVariants).not.toHaveBeenCalled();
    expect(readSetupPin()).toBeNull();
  });

  it.each([true, false])('acts immediately when unlocked (merge=%s)', async merge => {
    rememberSetupPin('2520');
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: merge ? 'OSG にまとめる' : '別のもの' }));
    await waitFor(() => expect(merge ? mergeInventoryValueVariants : dismissInventoryValueVariants).toHaveBeenCalledOnce());
    expect(verifyKioskDueManagementAccessPassword).not.toHaveBeenCalled();
  });

  it('uses the shared session, shows no tabs, and locks manually', () => {
    rememberSetupPin('2520');
    renderPage();
    expect(screen.getByRole('heading', { name: '集計' })).toBeInTheDocument();
    expect(screen.getByText('解除中')).toBeInTheDocument();
    expect(screen.getByText('解除中')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '在庫操作に戻る' })).toHaveAttribute('href', '/kiosk/inventory');
    fireEvent.click(screen.getByRole('button', { name: 'ロック' }));
    expect(screen.queryByText('4桁のパスワード')).not.toBeInTheDocument();
    expect(screen.queryByText('解除中')).not.toBeInTheDocument();
    expect(readSetupPin()).toBeNull();
  });

  it('opens item editing with router state while locked', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '単価を入れる' }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/kiosk/inventory/settings:{"tab":"items"}');
  });

  it('refreshes activity and locks after five idle minutes', () => {
    vi.useFakeTimers();
    rememberSetupPin('2520');
    renderPage();
    act(() => vi.advanceTimersByTime(4 * 60_000));
    fireEvent.pointerDown(screen.getByRole('heading', { name: '集計' }));
    act(() => vi.advanceTimersByTime(4 * 60_000));
    expect(screen.getByText('解除中')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByText('4桁のパスワード')).not.toBeInTheDocument();
    expect(screen.queryByText('解除中')).not.toBeInTheDocument();
  });
});
