import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from './App';

import type { ReactNode } from 'react';

vi.mock('./components/RequireAuth', () => ({ RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('./layouts/AdminLayout', () => ({ AdminLayout: () => <main data-testid="admin-layout"><Outlet /></main> }));
vi.mock('./features/webrtc/components/CallAutoSwitchLayout', () => ({ CallAutoSwitchLayout: () => <Outlet /> }));
vi.mock('./features/mobile-app-shell/registerMobileAppShell', () => ({ registerMobileAppShell: () => undefined }));
vi.mock('./components/hermes/HermesPageContext', () => ({ HermesPageContextProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('./components/hermes/HermesFloatingChat', () => ({ HermesFloatingChat: () => null }));
vi.mock('./features/kiosk/screen-watch/KioskScreenWatchHost', () => ({ KioskScreenWatchHost: () => null }));
vi.mock('./pages/admin/DashboardPage', () => ({ DashboardPage: () => <h1>dashboard</h1> }));
vi.mock('./pages/admin/DataBoardsPage', () => ({ DataBoardsPage: () => <h1>data-boards</h1> }));
vi.mock('./pages/admin/CsvImportPage', () => ({ CsvImportPage: () => <h1>csv-import</h1> }));
vi.mock('./pages/tools/HistoryPage', () => ({ HistoryPage: () => <h1>history</h1> }));
vi.mock('./pages/tools/MovedToKioskTagDeskPage', () => ({
  MovedToKioskTagDeskPage: ({ positionRanks }: { positionRanks?: boolean }) => <h1>{positionRanks ? 'moved-ranks' : 'moved'}</h1>
}));

let client: QueryClient | undefined;
afterEach(() => { cleanup(); client?.clear(); });
const mount = (path: string) => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>);
};

describe('App admin routes (lazy)', () => {
  it.each([
    ['/admin', 'dashboard'],
    ['/admin/tools/history', 'history'],
    ['/admin/history', 'history'],
    ['/admin/import', 'csv-import'],
    ['/admin/csv-dashboards', 'data-boards'],
    ['/admin/tools/items', 'moved'],
    ['/admin/knowledge-position-ranks', 'moved-ranks']
  ])('renders %s inside the admin layout', async (path, heading) => {
    mount(path);
    const layout = screen.getByTestId('admin-layout');
    expect(await within(layout).findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(within(layout).queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the preview import route inside the admin layout', async () => {
    mount('/preview/import');
    expect(await within(screen.getByTestId('admin-layout')).findByRole('heading', { name: 'csv-import' })).toBeInTheDocument();
  });
});
