import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kioskWebNavigation } from '../features/kiosk/kioskWebActivation';

import { KioskLayout } from './KioskLayout';

const acknowledgeDeployStatus = vi.fn();
let deployStatus: Record<string, unknown> | undefined;
const BUNDLE_RELEASE_SHA = 'a'.repeat(40);
const OTHER_RELEASE_SHA = 'b'.repeat(40);
const RELEASE_VERIFICATION_ID = '1'.repeat(32);
const ROLLBACK_VERIFICATION_ID = '2'.repeat(32);

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
    deployStatus = undefined;
    acknowledgeDeployStatus.mockReset();
    acknowledgeDeployStatus.mockResolvedValue({ acknowledged: true });
    vi.spyOn(kioskWebNavigation, 'replace').mockImplementation(() => undefined);
    window.sessionStorage.clear();
    vi.stubEnv('VITE_RELEASE_SHA', BUNDLE_RELEASE_SHA);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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
    expect(acknowledgeDeployStatus.mock.calls.some(([, phase]) => phase === 'ready')).toBe(false);
  });

  it('acknowledges ready with the actual compiled release SHA and keeps maintenance visible', async () => {
    deployStatus = {
      isMaintenance: true,
      runId: 'run-verifying',
      phase: 'verifying',
      desiredReleaseSha: BUNDLE_RELEASE_SHA,
      verificationId: RELEASE_VERIFICATION_ID
    };
    render(<MemoryRouter initialEntries={['/kiosk']}><KioskLayout /></MemoryRouter>);

    expect(screen.getByText('maintenance-screen')).toBeInTheDocument();
    await waitFor(() => expect(acknowledgeDeployStatus).toHaveBeenCalledWith(
      'run-verifying',
      'ready',
      BUNDLE_RELEASE_SHA,
      RELEASE_VERIFICATION_ID
    ));
  });

  it('does not let a cached stale bundle acknowledge a newer desired release', async () => {
    deployStatus = {
      isMaintenance: true,
      runId: 'run-cached-bundle',
      phase: 'verifying',
      desiredReleaseSha: OTHER_RELEASE_SHA,
      verificationId: RELEASE_VERIFICATION_ID
    };
    render(<MemoryRouter initialEntries={['/kiosk']}><KioskLayout /></MemoryRouter>);

    expect(screen.getByText('maintenance-screen')).toBeInTheDocument();
    await waitFor(() => expect(acknowledgeDeployStatus).toHaveBeenCalledWith(
      'run-cached-bundle',
      'maintenance'
    ));
    expect(acknowledgeDeployStatus.mock.calls.some(([, phase]) => phase === 'ready')).toBe(false);
    expect(kioskWebNavigation.replace).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-release-sha'],
    ['uppercase', BUNDLE_RELEASE_SHA.toUpperCase()]
  ])('does not acknowledge ready from a %s compiled release identity', async (_name, compiledReleaseSha) => {
    vi.stubEnv('VITE_RELEASE_SHA', compiledReleaseSha);
    deployStatus = {
      isMaintenance: true,
      runId: `run-${_name}`,
      phase: 'verifying',
      desiredReleaseSha: BUNDLE_RELEASE_SHA,
      verificationId: RELEASE_VERIFICATION_ID
    };
    render(<MemoryRouter initialEntries={['/kiosk']}><KioskLayout /></MemoryRouter>);

    expect(screen.getByText('maintenance-screen')).toBeInTheDocument();
    await waitFor(() => expect(acknowledgeDeployStatus).toHaveBeenCalledWith(
      `run-${_name}`,
      'maintenance'
    ));
    expect(acknowledgeDeployStatus.mock.calls.some(([, phase]) => phase === 'ready')).toBe(false);
  });

  it('does not acknowledge malformed desired identity or use it as the bundle identity', async () => {
    vi.stubEnv('VITE_RELEASE_SHA', OTHER_RELEASE_SHA);
    deployStatus = {
      isMaintenance: true,
      runId: 'run-invalid-desired',
      phase: 'verifying',
      desiredReleaseSha: BUNDLE_RELEASE_SHA.toUpperCase(),
      verificationId: RELEASE_VERIFICATION_ID
    };
    render(<MemoryRouter initialEntries={['/kiosk']}><KioskLayout /></MemoryRouter>);

    expect(screen.getByText('maintenance-screen')).toBeInTheDocument();
    await waitFor(() => expect(acknowledgeDeployStatus).toHaveBeenCalledWith(
      'run-invalid-desired',
      'maintenance'
    ));
    expect(acknowledgeDeployStatus.mock.calls.some(([, phase]) => phase === 'ready')).toBe(false);
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-verification-id'],
    ['uppercase', 'A'.repeat(32)]
  ])('does not acknowledge ready with a %s verification ID', async (_name, verificationId) => {
    deployStatus = {
      isMaintenance: true,
      runId: `run-verification-${_name}`,
      phase: 'verifying',
      desiredReleaseSha: BUNDLE_RELEASE_SHA,
      verificationId
    };
    render(<MemoryRouter initialEntries={['/kiosk']}><KioskLayout /></MemoryRouter>);

    expect(screen.getByText('maintenance-screen')).toBeInTheDocument();
    await waitFor(() => expect(acknowledgeDeployStatus).toHaveBeenCalledWith(
      `run-verification-${_name}`,
      'maintenance'
    ));
    expect(acknowledgeDeployStatus.mock.calls.some(([, phase]) => phase === 'ready')).toBe(false);
  });

  it('retries the same ready challenge after a transient acknowledgement failure', async () => {
    let readyAttempts = 0;
    acknowledgeDeployStatus.mockImplementation(async (_runId: string, phase: string) => {
      if (phase === 'ready' && readyAttempts++ === 0) {
        throw new Error('transient ready acknowledgement failure');
      }
      return { acknowledged: true };
    });
    deployStatus = {
      isMaintenance: true,
      runId: 'run-retry',
      phase: 'verifying',
      desiredReleaseSha: BUNDLE_RELEASE_SHA,
      verificationId: RELEASE_VERIFICATION_ID
    };
    render(<MemoryRouter initialEntries={['/kiosk']}><KioskLayout /></MemoryRouter>);

    await waitFor(() => expect(
      acknowledgeDeployStatus.mock.calls.filter(([, phase]) => phase === 'ready')
    ).toEqual([[
      'run-retry',
      'ready',
      BUNDLE_RELEASE_SHA,
      RELEASE_VERIFICATION_ID
    ]]));

    await waitFor(() => expect(
      acknowledgeDeployStatus.mock.calls.filter(([, phase]) => phase === 'ready')
    ).toEqual([
      ['run-retry', 'ready', BUNDLE_RELEASE_SHA, RELEASE_VERIFICATION_ID],
      ['run-retry', 'ready', BUNDLE_RELEASE_SHA, RELEASE_VERIFICATION_ID]
    ]), { timeout: 2500 });
  });

  it('sends one ready acknowledgement per verification cycle', async () => {
    deployStatus = {
      isMaintenance: true,
      runId: 'run-repeat',
      phase: 'verifying',
      desiredReleaseSha: BUNDLE_RELEASE_SHA,
      verificationCycle: 'release',
      verificationId: RELEASE_VERIFICATION_ID
    };
    const { rerender } = render(
      <MemoryRouter initialEntries={['/kiosk']}><KioskLayout /></MemoryRouter>
    );
    await waitFor(() => expect(
      acknowledgeDeployStatus.mock.calls.filter(([, phase]) => phase === 'ready')
    ).toHaveLength(1));

    deployStatus = { ...deployStatus };
    rerender(<MemoryRouter initialEntries={['/kiosk']}><KioskLayout /></MemoryRouter>);
    expect(acknowledgeDeployStatus.mock.calls.filter(([, phase]) => phase === 'ready')).toHaveLength(1);

    deployStatus = {
      isMaintenance: true,
      runId: 'run-repeat',
      phase: 'verifying',
      desiredReleaseSha: BUNDLE_RELEASE_SHA,
      verificationCycle: 'rollback',
      verificationId: ROLLBACK_VERIFICATION_ID
    };
    rerender(<MemoryRouter initialEntries={['/kiosk']}><KioskLayout /></MemoryRouter>);
    await waitFor(() => expect(
      acknowledgeDeployStatus.mock.calls.filter(([, phase]) => phase === 'ready')
    ).toHaveLength(2));
    expect(
      acknowledgeDeployStatus.mock.calls.filter(([, phase]) => phase === 'ready')
    ).toEqual([
      ['run-repeat', 'ready', BUNDLE_RELEASE_SHA, RELEASE_VERIFICATION_ID],
      ['run-repeat', 'ready', BUNDLE_RELEASE_SHA, ROLLBACK_VERIFICATION_ID]
    ]);
  });
});
