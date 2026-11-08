import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from './AuthContext';
const mocks = vi.hoisted(() => ({ loginRequest: vi.fn(), logoutRequest: vi.fn(), setAuthToken: vi.fn() }));
vi.mock('../api/client', () => mocks);
const session = { accessToken: 'access', refreshToken: 'refresh', user: { id: 'u1', username: 'alice', role: 'ADMIN', mfaEnabled: true } };
function Harness() {
  const auth = useAuth();
  return <><output>{auth.token ?? 'signed out'}</output><button onClick={() => void auth.login('alice', 'password', { rememberMe: true })}>login</button><button onClick={() => void auth.logout()}>logout</button></>;
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.loginRequest.mockResolvedValue(session); });
describe('admin logout', () => {
  it('waits for server logout before clearing the local session', async () => {
    let finish!: () => void;
    mocks.logoutRequest.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<AuthProvider><Harness /></AuthProvider>);
    fireEvent.click(screen.getByText('login'));
    await screen.findByText('access');
    fireEvent.click(screen.getByText('logout'));
    expect(mocks.logoutRequest).toHaveBeenCalledOnce();
    expect(localStorage.getItem('factory-auth')).not.toBeNull();
    await act(async () => finish());
    await screen.findByText('signed out');
    expect(localStorage.getItem('factory-auth')).toBeNull();
    expect(mocks.setAuthToken).toHaveBeenLastCalledWith(undefined);
  });
  it('clears the local session when server logout fails', async () => {
    mocks.logoutRequest.mockRejectedValue(new Error('offline'));
    render(<AuthProvider><Harness /></AuthProvider>);
    fireEvent.click(screen.getByText('login'));
    await screen.findByText('access');
    fireEvent.click(screen.getByText('logout'));
    await screen.findByText('signed out');
    expect(localStorage.getItem('factory-auth')).toBeNull();
  });
  it('limits remembered login to seven days', async () => {
    render(<AuthProvider><Harness /></AuthProvider>);
    const before = Date.now();
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(localStorage.getItem('factory-auth')).not.toBeNull());
    const stored = JSON.parse(localStorage.getItem('factory-auth')!);
    expect(new Date(stored.expiresAt).getTime() - before).toBeLessThanOrEqual(7 * 86400000 + 1000);
  });
});
