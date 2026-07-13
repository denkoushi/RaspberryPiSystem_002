import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskLayout } from './KioskLayout';

const acknowledgeDeployStatus = vi.fn();
let deployStatus: Record<string, unknown> | undefined;

vi.mock('../api/client', () => ({
  getResolvedClientKey: () => 'client-key',
  setClientKeyHeader: vi.fn()
}));

vi.mock('../api/domains/system', () => ({
  acknowledgeDeployStatus: (...args: unknown[]) => acknowledgeDeployStatus(...args)
}));

vi.mock('../api/hooks', () => ({
  useDeployStatus: () => ({ data: deployStatus }),
  useKioskCallTargets: () => ({ data: { selfClientId: 'kiosk-1' } }),
  useKioskConfig: () => ({ data: {} })
}));

vi.mock('../components/kiosk/KioskHeader', () => ({ KioskHeader: () => <div>kiosk-header</div> }));
vi.mock('../components/kiosk/KioskMaintenanceScreen', () => ({ KioskMaintenanceScreen: () => <div>maintenance-screen</div> }));
vi.mock('../components/kiosk/KioskSupportModal', () => ({ KioskSupportModal: () => null }));
vi.mock('../components/KioskRedirect', () => ({ KioskRedirect: () => <div>normal-kiosk-content</div> }));
vi.mock('../hooks/useKioskBottomCenterHeaderReveal', () => ({
  useKioskBottomCenterHeaderReveal: () => ({
    isVisible: true,
    onHotZoneEnter: vi.fn(),
    onHeaderMouseEnter: vi.fn(),
    onHeaderMouseLeave: vi.fn()
  })
}));

describe('KioskLayout deploy status handling', () => {
  beforeEach(() => {
    acknowledgeDeployStatus.mockReset();
    acknowledgeDeployStatus.mockResolvedValue({ acknowledged: true });
  });

  it('keeps the normal kiosk usable while acknowledging a pre-notice once', async () => {
    deployStatus = {
      isMaintenance: false,
      runId: 'run-notice',
      preNotice: { scheduledAt: '2026-07-13T00:01:00.000Z' }
    };
    render(<MemoryRouter initialEntries={['/kiosk']}><KioskLayout /></MemoryRouter>);

    expect(screen.getByText('normal-kiosk-content')).toBeInTheDocument();
    expect(screen.getByTestId('kiosk-deploy-pre-notice')).toBeInTheDocument();
    await waitFor(() => expect(acknowledgeDeployStatus).toHaveBeenCalledWith('run-notice', 'notice'));
  });

  it('replaces normal kiosk content only after maintenance begins', async () => {
    deployStatus = { isMaintenance: true, runId: 'run-maintenance', phase: 'preparing' };
    render(<MemoryRouter initialEntries={['/kiosk']}><KioskLayout /></MemoryRouter>);

    expect(screen.getByText('maintenance-screen')).toBeInTheDocument();
    expect(screen.queryByText('normal-kiosk-content')).not.toBeInTheDocument();
    await waitFor(() => expect(acknowledgeDeployStatus).toHaveBeenCalledWith('run-maintenance', 'maintenance'));
  });
});
