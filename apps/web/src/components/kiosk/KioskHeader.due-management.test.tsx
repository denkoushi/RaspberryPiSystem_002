import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('../../api/client', () => ({ postKioskPower: vi.fn() }));
vi.mock('../../api/hooks', () => ({ useUpdateKioskInitialRoute: () => ({ mutateAsync: vi.fn(), isPending: false }), useVerifyKioskDueManagementAccessPassword: () => ({ mutateAsync: mocks.verify, isPending: false }) }));
vi.mock('./KioskSignagePreviewModal', () => ({ KioskSignagePreviewModal: () => null }));
vi.mock('../../features/kiosk/kioskHeaderTabs/kioskHeaderReorderableTabRenderer', () => ({
  renderKioskReorderableHeaderTab: (_tab: unknown, context: { onDueManagementNavigate: () => void }) => (
    <button key="due-management" onClick={context.onDueManagementNavigate}>納期管理</button>
  )
}));

import { DUE_MANAGEMENT_AUTH_SESSION_KEY, DUE_MANAGEMENT_TOKEN_SESSION_KEY } from '../../api/domains/production-schedule';

import { KioskHeader } from './KioskHeader';

function renderHeader(pathname = '/kiosk/production-schedule/due-management') {
  return render(<MemoryRouter><KioskHeader clientKey="device" clientId="device" onOpenSupport={() => {}} pathname={pathname} navTabOrder={['due_management']} /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.spyOn(window, 'prompt').mockReturnValue('test-password');
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  mocks.verify.mockResolvedValue({ success: true, token: 'session-token' });
});
afterEach(() => vi.restoreAllMocks());

describe('due-management password navigation', () => {
  it('stores the confirmed token and mark together', async () => {
    renderHeader('/kiosk');
    fireEvent.click(screen.getByRole('button', { name: '納期管理' }));
    await waitFor(() => expect(window.sessionStorage.getItem(DUE_MANAGEMENT_TOKEN_SESSION_KEY)).toBe('session-token'));
    expect(window.sessionStorage.getItem(DUE_MANAGEMENT_AUTH_SESSION_KEY)).toBe('1');
  });

  it('allows password re-entry on the current due-management page after authentication is cleared', async () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: '納期管理' }));
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledWith({ password: 'test-password' }));
    expect(window.prompt).toHaveBeenCalledOnce();
    await waitFor(() => expect(window.sessionStorage.getItem(DUE_MANAGEMENT_TOKEN_SESSION_KEY)).toBe('session-token'));
  });

  it('asks again when only the legacy mark exists', async () => {
    window.sessionStorage.setItem(DUE_MANAGEMENT_AUTH_SESSION_KEY, '1');
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: '納期管理' }));
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce());
  });

  it('reuses a confirmed session without a prompt', () => {
    window.sessionStorage.setItem(DUE_MANAGEMENT_AUTH_SESSION_KEY, '1');
    window.sessionStorage.setItem(DUE_MANAGEMENT_TOKEN_SESSION_KEY, 'session-token');
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: '納期管理' }));
    expect(window.prompt).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('does not store authentication when password confirmation fails', async () => {
    mocks.verify.mockResolvedValueOnce({ success: false });
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: '納期管理' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('パスワードが違います'));
    expect(window.sessionStorage.getItem(DUE_MANAGEMENT_AUTH_SESSION_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(DUE_MANAGEMENT_TOKEN_SESSION_KEY)).toBeNull();
  });
});
