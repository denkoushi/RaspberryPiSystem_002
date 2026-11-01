import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';

import { KioskPortalPage } from './KioskPortalPage';
import { KioskProcedureBoardPage } from './KioskProcedureBoardPage';

vi.mock('../../api/hooks', () => ({ useKioskConfig: () => ({ data: { defaultMode: 'PHOTO', navTabOrder: [] } }) }));
vi.mock('../../features/kiosk/kioskHeaderTabs/useKioskDueManagementNavigation', () => ({ useKioskDueManagementNavigation: () => ({}) }));
vi.mock('../../api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
function show(path = '/kiosk/portal') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route element={<Outlet context={{ portalLargeScreen: false }} />}><Route path="/kiosk/portal" element={<KioskPortalPage />} />
      <Route path="/kiosk/procedure-board" element={<KioskProcedureBoardPage />} /><Route path="/kiosk/procedure-board/:procedureId" element={<KioskProcedureBoardPage />} />
    </Route></Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => vi.resetAllMocks());
describe('procedure board entry', () => {
  it.each([[true, true, true], [true, false, false], [false, true, false], [null, true, false], [undefined, true, false]])('device=%s knowledge=%s entry=%s', async (device, knowledge, visible) => {
    vi.mocked(api.get).mockImplementation(async url => ({ data: url === '/mobile-placement/client-capabilities' ? { procedureBoardEnabled: device } : { enabled: knowledge } }));
    show(); await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    await waitFor(() => visible ? expect(screen.getByRole('link', { name: '手順づくり' })).toHaveAttribute('href', '/kiosk/procedure-board') : expect(screen.queryByRole('link', { name: '手順づくり' })).toBeNull());
  });
  it('fails closed and protects direct routes when capability fetch fails', async () => {
    vi.mocked(api.get).mockRejectedValue({ response: { status: 403 } }); show('/kiosk/procedure-board/topic');
    expect(await screen.findByRole('alert')).toHaveTextContent('手順づくりは無効です'); expect(api.post).not.toHaveBeenCalled();
  });
  it('lists actual procedure titles without creating boards', async () => {
    vi.mocked(api.get).mockImplementation(async url => ({ data: url.includes('/procedures') ? { procedures: [{ procedureId: 'topic', title: '点検', boardId: null }], nextCursor: null }
      : url.includes('client-capabilities') ? { procedureBoardEnabled: true } : { enabled: true } }));
    show('/kiosk/procedure-board');
    expect(await screen.findByRole('link', { name: '点検' })).toHaveAttribute('href', '/kiosk/procedure-board/topic'); expect(api.post).not.toHaveBeenCalled();
  });
});
