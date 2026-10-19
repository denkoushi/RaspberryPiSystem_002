import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../../contexts/AuthContext';

import { DgxResourceAdminPage } from './DgxResourceAdminPage';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../features/admin/dgx-resource/DgxResourceDashboard', () => ({ DgxResourceDashboard: () => <div>業務 LLM の画面</div> }));
afterEach(cleanup);

function mount(role: string | null) {
  vi.mocked(useAuth).mockReturnValue({ user: role ? { role } : null } as ReturnType<typeof useAuth>);
  return render(<MemoryRouter initialEntries={['/admin/tools/dgx-resource']}><Routes>
    <Route path="/admin/tools/dgx-resource" element={<DgxResourceAdminPage />} />
    <Route path="/admin" element={<div>管理トップ</div>} />
  </Routes></MemoryRouter>);
}
describe('DGX resource page access', () => {
  it.each(['ADMIN', 'MANAGER'])('shows the page to %s', (role) => { mount(role); expect(screen.getByText('業務 LLM の画面')).toBeInTheDocument(); });
  it('redirects VIEWER to admin', () => { mount('VIEWER'); expect(screen.getByText('管理トップ')).toBeInTheDocument(); });
  it('shows nothing before authentication', () => { const { container } = mount(null); expect(container).toBeEmptyDOMElement(); });
});
