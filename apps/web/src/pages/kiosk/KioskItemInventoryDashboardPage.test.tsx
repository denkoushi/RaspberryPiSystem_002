import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useVerifyKioskDueManagementAccessPassword } from '../../api/hooks';
import { clearSetupPin, readSetupPin, rememberSetupPin } from '../../features/kiosk/inventory/setup/setupPinSession';

import { KioskItemInventoryDashboardPage } from './KioskItemInventoryDashboardPage';

vi.mock('../../api/hooks', () => ({ useVerifyKioskDueManagementAccessPassword: vi.fn() }));
vi.mock('../../features/kiosk/inventory/setup/InventoryDashboardTab', () => ({
  InventoryDashboardTab: ({ accessPassword, onEditItems }: { accessPassword: string; onEditItems: () => void }) => (
    <div>dashboard-open:{accessPassword}<button onClick={onEditItems}>単価を入れる</button></div>
  ),
}));

function SettingsDestination() {
  const location = useLocation();
  return <div data-testid="destination">{location.pathname}:{JSON.stringify(location.state)}</div>;
}

function renderPage() {
  return render(<MemoryRouter initialEntries={['/kiosk/inventory/dashboard']}>
    <Routes>
      <Route path="/kiosk/inventory/dashboard" element={<KioskItemInventoryDashboardPage />} />
      <Route path="/kiosk/inventory/settings" element={<SettingsDestination />} />
    </Routes>
  </MemoryRouter>);
}

describe('KioskItemInventoryDashboardPage', () => {
  beforeEach(() => {
    clearSetupPin();
    vi.mocked(useVerifyKioskDueManagementAccessPassword).mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({ success: true }), isPending: false } as never);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('requires a PIN when locked and remembers the verified PIN', async () => {
    renderPage();
    const keypad = within(screen.getByRole('group', { name: 'パスワードのテンキー' }));
    expect(screen.queryByText(/dashboard-open/)).not.toBeInTheDocument();
    for (const digit of '2520') fireEvent.click(keypad.getByRole('button', { name: digit, exact: true }));
    expect(await screen.findByText('dashboard-open:2520')).toBeInTheDocument();
    expect(readSetupPin()).toBe('2520');
  });

  it('uses the shared session, shows no tabs, and locks manually', () => {
    rememberSetupPin('2520');
    renderPage();
    expect(screen.getByRole('heading', { name: '集計' })).toBeInTheDocument();
    expect(screen.getByText('解除中')).toBeInTheDocument();
    expect(screen.getByText('dashboard-open:2520')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '在庫操作に戻る' })).toHaveAttribute('href', '/kiosk/inventory');
    fireEvent.click(screen.getByRole('button', { name: 'ロック' }));
    expect(screen.getByRole('group', { name: 'パスワードのテンキー' })).toBeInTheDocument();
    expect(readSetupPin()).toBeNull();
  });

  it('opens item editing with router state', () => {
    rememberSetupPin('2520');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '単価を入れる' }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/kiosk/inventory/settings:{"tab":"items"}');
  });

  it('refreshes activity and locks after five idle minutes', () => {
    vi.useFakeTimers();
    rememberSetupPin('2520');
    renderPage();
    act(() => vi.advanceTimersByTime(4 * 60_000));
    fireEvent.pointerDown(screen.getByRole('heading', { name: '集計' }));
    act(() => vi.advanceTimersByTime(4 * 60_000));
    expect(screen.getByText('dashboard-open:2520')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('group', { name: 'パスワードのテンキー' })).toBeInTheDocument();
  });
});
