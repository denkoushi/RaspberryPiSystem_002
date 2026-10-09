import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '../../contexts/AuthContext';

import { SecurityPage } from './SecurityPage';

const mocks = vi.hoisted(() => ({
  loginRequest: vi.fn(), setAuthToken: vi.fn(), getRoleAuditLogs: vi.fn(),
  mfaInitiate: vi.fn(), mfaActivate: vi.fn(), mfaDisable: vi.fn()
}));
vi.mock('../../api/client', () => mocks);

const user = {
  id: 'admin', username: 'admin', role: 'ADMIN' as const,
  mfaEnabled: false, mfaSetupRequired: true, mfaRequired: true
};
const session = { accessToken: 'old-access', refreshToken: 'old-refresh', user };
const activation = {
  accessToken: 'new-access', refreshToken: 'new-refresh',
  user: { ...user, mfaEnabled: true, mfaSetupRequired: false }, backupCodes: ['backup-code']
};

function Harness() {
  const auth = useAuth();
  return <>
    <p>Current token: {auth.token}</p>
    <button onClick={() => void auth.login('admin', 'password')}>Log in</button>
    {auth.user && <SecurityPage />}
  </>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.loginRequest.mockResolvedValue(session);
  mocks.getRoleAuditLogs.mockResolvedValue([]);
  mocks.mfaInitiate.mockResolvedValue({ secret: 'test-secret', otpauthUrl: 'otpauth://test', backupCodes: ['backup-code'] });
  mocks.mfaActivate.mockResolvedValue(activation);
});

function remember(storedUser = user) {
  localStorage.setItem('factory-auth', JSON.stringify({
    token: session.accessToken, refresh: session.refreshToken, user: storedUser,
    expiresAt: '2099-01-01T00:00:00.000Z'
  }));
}

describe('SecurityPage MFA setup', () => {
  it.each([true, false])('updates the session without login after activation (remembered=%s)', async (remembered) => {
    if (remembered) remember();
    render(<AuthProvider><Harness /></AuthProvider>);
    if (!remembered) fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('設定が終わるまで他の画面は使えません');
    expect(mocks.getRoleAuditLogs).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '再読込' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'MFAを無効化' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'セットアップ情報を生成' }));
    const input = await screen.findByPlaceholderText('6桁コード');
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'コードを確認して有効化' }));
    await screen.findByText('MFAを有効化しました。バックアップコードを安全な場所に保管してください。');
    expect(screen.getByText('Current token: new-access')).toBeInTheDocument();
    expect(screen.getByText('MFA有効')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'MFAを無効化' })).not.toBeInTheDocument();
    expect(mocks.setAuthToken).toHaveBeenCalledWith('new-access');
    await waitFor(() => expect(mocks.getRoleAuditLogs).toHaveBeenCalledOnce());
    if (remembered) {
      expect(JSON.parse(localStorage.getItem('factory-auth')!)).toEqual({
        token: activation.accessToken, refresh: activation.refreshToken,
        user: activation.user, expiresAt: '2099-01-01T00:00:00.000Z'
      });
    } else {
      expect(localStorage.getItem('factory-auth')).toBeNull();
    }
  });

  it('keeps disabling available and loads audit logs when enforcement is off', async () => {
    remember({ ...user, mfaSetupRequired: false, mfaRequired: false });
    render(<AuthProvider><Harness /></AuthProvider>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MFAを無効化' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getRoleAuditLogs).toHaveBeenCalledOnce());
  });

  it('leaves the setup guard in place if activation fails', async () => {
    remember();
    mocks.mfaActivate.mockRejectedValue(new Error('invalid code'));
    render(<AuthProvider><Harness /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'セットアップ情報を生成' }));
    fireEvent.change(await screen.findByPlaceholderText('6桁コード'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'コードを確認して有効化' }));
    await screen.findByText('MFAの有効化に失敗しました。コードを確認してください。');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Current token: old-access')).toBeInTheDocument();
    expect(mocks.getRoleAuditLogs).not.toHaveBeenCalled();
  });
});
