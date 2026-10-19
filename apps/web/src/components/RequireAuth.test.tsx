import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequireAuth } from './RequireAuth';

const auth = vi.hoisted(() => ({ user: { mfaSetupRequired: false } as { mfaSetupRequired: boolean } | null, loading: false }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }));

function renderAt(path: string) {
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/login" element={<p>Login</p>} />
    <Route path="/admin" element={<RequireAuth><p>Admin</p></RequireAuth>} />
    <Route path="/admin/security" element={<RequireAuth><p>Security</p></RequireAuth>} />
  </Routes></MemoryRouter>);
}

beforeEach(() => { auth.user = { mfaSetupRequired: false }; auth.loading = false; });

describe('RequireAuth', () => {
  it('redirects accounts requiring setup to Security', () => {
    auth.user!.mfaSetupRequired = true;
    renderAt('/admin');
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });
  it('keeps accounts without setup requirements on the requested page', () => {
    renderAt('/admin');
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });
  it('allows Security while setup is required, including query strings', () => {
    auth.user!.mfaSetupRequired = true;
    renderAt('/admin/security?setup=1');
    expect(screen.getByText('Security')).toBeInTheDocument();
  });
  it('preserves the login redirect', () => {
    auth.user = null;
    renderAt('/admin');
    expect(screen.getByText('Login')).toBeInTheDocument();
  });
  it('waits for authentication before redirecting', () => {
    auth.loading = true;
    auth.user!.mfaSetupRequired = true;
    renderAt('/admin');
    expect(screen.getByText('認証状態を確認しています...')).toBeInTheDocument();
    expect(screen.queryByText('Security')).not.toBeInTheDocument();
  });
});
