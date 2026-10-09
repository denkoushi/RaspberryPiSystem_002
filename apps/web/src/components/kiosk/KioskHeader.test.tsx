import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { KioskHeader } from './KioskHeader';

vi.mock('../../api/client', () => ({ postKioskPower: vi.fn() }));
vi.mock('../../api/hooks', () => ({ useUpdateKioskInitialRoute: () => ({ mutateAsync: vi.fn(), isPending: false }), useVerifyKioskDueManagementAccessPassword: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('./KioskSignagePreviewModal', () => ({ KioskSignagePreviewModal: () => null }));

function renderHeader(clientStatus: { temperature: number | null; cpuUsage: number } | null = { temperature: 48.24, cpuUsage: 12.4 }) {
  return render(<MemoryRouter><KioskHeader clientKey="client-key-1234" clientId="call-id-5678" onOpenSupport={vi.fn()} pathname="/kiosk/call" navTabOrder={['call']} clientStatus={clientStatus} /></MemoryRouter>);
}

describe('KioskHeader status chip', () => {
  it.each([true, false])('shows maintenance details only in the popover (status available: %s)', (hasStatus) => {
    renderHeader(hasStatus ? { temperature: 48.24, cpuUsage: 12.4 } : null);
    expect(screen.queryByText('キオスク端末')).not.toBeInTheDocument();
    expect(screen.queryByText('APIキー')).not.toBeInTheDocument();
    expect(screen.queryByText('通話ID')).not.toBeInTheDocument();
    expect(screen.queryByText('clie…1234')).not.toBeInTheDocument();
    expect(screen.queryByText('call…5678')).not.toBeInTheDocument();
    const chip = screen.getByRole('button', { name: '端末の状態' });
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(chip).toHaveTextContent(hasStatus ? '48.2°C12%' : '端末');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('キオスク端末')).toBeInTheDocument();
    expect(screen.getByText('APIキー')).toBeInTheDocument();
    expect(screen.getByText('通話ID')).toBeInTheDocument();
    expect(screen.getByText('clie…1234')).toBeInTheDocument();
    expect(screen.getByText('call…5678')).toBeInTheDocument();
    if (hasStatus) {
      expect(screen.getByText('CPU温度')).toBeInTheDocument();
      expect(screen.getByText('CPU負荷')).toBeInTheDocument();
    } else {
      expect(screen.queryByText('CPU温度')).not.toBeInTheDocument();
      expect(screen.queryByText('CPU負荷')).not.toBeInTheDocument();
    }
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(chip).toHaveFocus();
  });

  it('omits null temperatures, keeps inside clicks open and closes on outside pointerdown', () => {
    renderHeader({ temperature: null, cpuUsage: 60 });
    const chip = screen.getByRole('button', { name: '端末の状態' });
    expect(chip).toHaveTextContent('60%');
    expect(chip).not.toHaveTextContent('°C');
    fireEvent.click(chip);
    expect(screen.queryByText('CPU温度')).not.toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText('APIキー'));
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(document.body);
    expect(chip).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps power menu clicks and confirmation on the existing modal path', () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: '電源メニュー' }));
    const menu = screen.getByRole('dialog', { name: '電源操作' });
    fireEvent.pointerDown(menu);
    expect(menu).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再起動' }));
    expect(screen.getByRole('dialog', { name: '端末を再起動しますか？' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
